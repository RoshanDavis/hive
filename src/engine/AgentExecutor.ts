import type { ExecutionContext, NodeExecutor, NodeOutputEnvelope } from "./types";
import { setOutputEnvelope } from "./nodeData";
import {
  callLlm,
  callLlmWithTools,
  llmRequiresCredential,
  resolveLlmConfig,
  resolveLlmInputMessages,
  type LlmConfig,
} from "./llmInference";
import {
  buildAgentTools,
  executeToolCall,
  type ResolvedTool,
  type ToolTraceStep,
} from "./agentTools";
import type { AgentChatMessage, ToolSchema } from "@/services/api";
import type {
  AgentNodeData,
  AgentStorageSlot,
  ChatMessage,
  JSONStorageRecord,
} from "@/nodes/types";

/** Default cap on model⇄tool round-trips, so a model that keeps calling tools can't
 * loop forever. Each iteration is one model turn (+ any tools it requested). A per-agent
 * `toolSettings.maxIterations` may override this up to {@link MAX_AGENT_ITERATIONS_CEIL}. */
export const MAX_AGENT_ITERATIONS = 8;

/** Absolute ceiling on the per-agent iteration override (a runaway guard). */
export const MAX_AGENT_ITERATIONS_CEIL = 25;

/** Resolve the effective iteration cap from an optional per-agent override. */
function resolveMaxIterations(override: number | undefined): number {
  if (typeof override !== "number" || !Number.isFinite(override)) return MAX_AGENT_ITERATIONS;
  return Math.max(1, Math.min(MAX_AGENT_ITERATIONS_CEIL, Math.floor(override)));
}

/** How many recent storage records to fold back into the system prompt as memory. */
const MEMORY_DIGEST_LIMIT = 5;
/** Per-entry character cap for the memory digest, so the prompt stays bounded. */
const MEMORY_ENTRY_MAX = 240;
/** Per-line cap for tool results in the human-readable run log. */
const LOG_RESULT_MAX = 300;

/**
 * Append the agent's output to its internal storage slot (its memory log),
 * mirroring the record shape the engine's post-execution storage sync writes to
 * jsonStorage nodes. Returns a new slot (records are decoupled to disk on save).
 */
function appendStorageRecord(
  slot: AgentStorageSlot,
  envelope: NodeOutputEnvelope,
  source: string
): AgentStorageSlot {
  const records = Array.isArray(slot.records) ? slot.records : [];
  const record: JSONStorageRecord = {
    id: Date.now().toString(),
    timestamp: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    source,
    content: envelope.value,
    envelope,
    createdAt: new Date().toISOString(),
  };
  return { ...slot, records: [...records, record] };
}

/** Compose the agent's effective system prompt: the LLM slot's base prompt, a
 * digest of recent memory (Storage slot), and brief tool-use guidance. Empty
 * inputs contribute nothing, so an agent with no prompt/memory/tools yields "". */
function composeAgentSystemPrompt(
  base: string,
  storage: AgentStorageSlot | null,
  hasTools: boolean,
  skillCatalog: string
): string {
  const parts: string[] = [];
  const trimmedBase = base.trim();
  if (trimmedBase) parts.push(trimmedBase);

  const records = storage && Array.isArray(storage.records) ? storage.records : [];
  if (records.length > 0) {
    const recent = records
      .slice(-MEMORY_DIGEST_LIMIT)
      .map((r) => {
        const c = (r.content || "").replace(/\s+/g, " ").trim();
        return `- ${c.length > MEMORY_ENTRY_MAX ? `${c.slice(0, MEMORY_ENTRY_MAX)}…` : c}`;
      })
      .join("\n");
    parts.push(`Recent memory (your most recent stored entries):\n${recent}`);
  }

  if (skillCatalog.trim()) {
    parts.push(
      "Available skills (call the `load_skill` tool with the skill's id to read its full " +
        `instructions before acting on it):\n${skillCatalog}`
    );
  }

  if (hasTools) {
    parts.push(
      "You can call the provided tools when they help answer the request. " +
        "Call a tool only when needed, then use its result to answer. " +
        "If no tool is needed, answer directly."
    );
  }
  return parts.join("\n\n");
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Executor for the composite Agent node. Resolves input like the LLM node
 * (upstream chat / text), composes a system prompt (base ⊕ memory ⊕ tool
 * guidance), then either runs a single inference (no runnable tools) or the
 * tool-calling loop: model → execute requested tools → feed results back →
 * repeat until a final answer or the iteration cap. The final answer is appended
 * to the Storage slot and written as the output envelope; a tool trace is recorded
 * on `envelope.data.toolTrace` and a human-readable run log on `node.data.logs`.
 */
export class AgentExecutor implements NodeExecutor {
  async execute(context: ExecutionContext): Promise<void> {
    const { node, updateNodeData, showToast, workspacePath } = context;
    const data = node.data as AgentNodeData;

    const llmSlot = data.llm;
    if (!llmSlot) {
      throw new Error(
        "Agent has no LLM configured. Open the Agent inspector and fill its LLM slot."
      );
    }

    const config = resolveLlmConfig(llmSlot);
    if (llmRequiresCredential(config.provider) && !config.credentialId) {
      throw new Error(
        `No credential selected for ${config.provider}. Open the Agent inspector and pick or add one in the LLM slot.`
      );
    }

    // Resolve selected tools into model-ready schemas, then compose the system
    // prompt (which depends on whether any tools are available).
    const { schemas, lookup, notes, skillCatalog } = await buildAgentTools(
      data.tools ?? null,
      workspacePath
    );
    config.systemPrompt = composeAgentSystemPrompt(
      config.systemPrompt,
      data.storage ?? null,
      schemas.length > 0,
      skillCatalog
    );

    const inputMessages = resolveLlmInputMessages(context, config.chatHistoryLimit);

    try {
      const { envelope, logs } =
        schemas.length === 0
          ? { envelope: await callLlm(config, inputMessages, workspacePath), logs: notes }
          : await this.runToolLoop(config, inputMessages, schemas, lookup, notes, context);

      const update: Record<string, unknown> = setOutputEnvelope(node.data, envelope);
      if (logs.length > 0) update.logs = logs;
      if (data.storage) {
        update.storage = appendStorageRecord(
          data.storage,
          envelope,
          String(data.label || "Agent")
        );
      }
      updateNodeData(node.id, update);
    } catch (err) {
      showToast(`Agent execution error: ${err}`, "error");
      throw err;
    }
  }

  /**
   * The model⇄tool loop. Maintains a working conversation (without the system
   * message, which `callLlmWithTools` prepends each turn), executes requested
   * tools, feeds results back, and stops on a tool-call-free turn or the cap.
   */
  private async runToolLoop(
    config: LlmConfig,
    inputMessages: ChatMessage[],
    schemas: ToolSchema[],
    lookup: Map<string, ResolvedTool>,
    notes: string[],
    context: ExecutionContext
  ): Promise<{ envelope: NodeOutputEnvelope; logs: string[] }> {
    const { node, workspacePath } = context;
    const data = node.data as AgentNodeData;
    const webSearchCredentialId = data.tools?.toolSettings?.webSearchCredentialId ?? null;
    const maxIterations = resolveMaxIterations(data.tools?.toolSettings?.maxIterations);

    const working: AgentChatMessage[] = inputMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const trace: ToolTraceStep[] = [];
    const logs: string[] = [...notes];
    let finalText: string | null = null;
    let lastContent = "";
    let iterations = 0;

    for (let i = 0; i < maxIterations; i++) {
      iterations = i + 1;
      const turn = await callLlmWithTools(config, working, schemas, workspacePath);
      if (turn.content) lastContent = turn.content;

      if (!turn.tool_calls || turn.tool_calls.length === 0) {
        finalText = turn.content ?? "";
        break;
      }

      // The model asked for tools: record the assistant turn, run them, feed back.
      working.push({
        role: "assistant",
        content: turn.content ?? null,
        tool_calls: turn.tool_calls,
      });

      for (const call of turn.tool_calls) {
        const result = await executeToolCall(call, lookup, {
          workspacePath,
          webSearchCredentialId,
        });
        working.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.name,
          content: result.content,
        });
        trace.push({
          name: result.name,
          arguments: call.arguments,
          content: result.content,
          error: result.error,
        });
        logs.push(
          `🔧 ${result.name}(${truncate(call.arguments || "{}", 120)}) → ${
            result.error ? "error: " : ""
          }${truncate(result.content, LOG_RESULT_MAX)}`
        );
      }
    }

    if (finalText === null) {
      finalText = lastContent
        ? `${lastContent}\n\n(Note: reached the maximum number of tool-call iterations.)`
        : "Reached the maximum number of tool-call iterations without a final answer.";
      logs.push(`⚠️ Stopped after ${maxIterations} iterations.`);
    }

    const envelope: NodeOutputEnvelope = {
      value: finalText,
      metadata: {
        model: config.modelName,
        provider: config.provider,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        iterations,
        toolCalls: trace.length,
        timestamp: new Date().toISOString(),
      },
      data: { reply: finalText, toolTrace: trace },
    };

    return { envelope, logs };
  }
}
