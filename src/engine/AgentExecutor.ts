import type { ExecutionContext, NodeExecutor, NodeOutputEnvelope } from "./types";
import { setOutputEnvelope } from "./nodeData";
import {
  callLlm,
  llmRequiresCredential,
  resolveLlmConfig,
  resolveLlmInputMessages,
} from "./llmInference";
import type { AgentNodeData, AgentStorageSlot, JSONStorageRecord } from "@/nodes/types";

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

/**
 * Executor for the composite Agent node. Resolves input like the LLM node
 * (upstream chat / text), runs one inference through the shared LLM path using
 * the agent's LLM slot, appends the result to its storage slot, and writes the
 * output envelope. Tool-calling is deferred (see docs/agent-node.md).
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

    // TODO(tools): once the Rust llm_chat command supports tool-calling, pass
    // the resolved tool definitions from data.tools and run the tool loop here.
    // For now the agent performs a single inference.

    const messages = resolveLlmInputMessages(context, config.chatHistoryLimit);

    let envelope: NodeOutputEnvelope;
    try {
      envelope = await callLlm(config, messages, workspacePath);
    } catch (err) {
      showToast(`Agent execution error: ${err}`, "error");
      throw err;
    }

    const update: Record<string, unknown> = setOutputEnvelope(node.data, envelope);
    if (data.storage) {
      update.storage = appendStorageRecord(
        data.storage,
        envelope,
        String(data.label || "Agent")
      );
    }
    updateNodeData(node.id, update);
  }
}
