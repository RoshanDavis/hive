// Agent tool resolution + dispatch. Turns an Agent's selected tools into
// model-ready function schemas (offered to the LLM) and executes the tool calls
// the model requests. Execution happens server-side (Rust `run_native_tool`); the
// renderer only supplies the tool id + arguments (+ a bound web_search credential).
//
// Phase 1 scope: only the runnable built-in *native* tools are offered. User-added
// native tools and all MCP servers / skills are skipped, with a note recorded so
// the run trace explains the omission. See docs/agent-node.md.

import { api, type ToolCall, type ToolDef, type ToolSchema } from "@/services/api";
import { toolsService } from "@/services/toolsService";
import { RUNNABLE_NATIVE_TOOL_IDS } from "@/services/builtInTools";
import type { AgentToolsSlot } from "@/nodes/types";

export interface BuiltAgentTools {
  /** Function schemas to offer the model. Empty ⇒ the agent runs a single inference. */
  schemas: ToolSchema[];
  /** Map of tool name (== tool id) → its def, used to dispatch execution. */
  lookup: Map<string, ToolDef>;
  /** Human-readable notes about selected-but-skipped tools (shown in the run log). */
  notes: string[];
}

export interface ToolExecResult {
  name: string;
  content: string;
  /** Set when the tool failed; `content` then holds a human-readable error. */
  error?: string;
}

/** One executed tool call, recorded on the output envelope's `data.toolTrace`. */
export interface ToolTraceStep {
  name: string;
  /** The raw JSON-string arguments the model passed. */
  arguments: string;
  /** The tool's textual result (or error message). */
  content: string;
  error?: string;
}

/** Fallback parameter schema when a tool def carries none. */
const EMPTY_SCHEMA: Record<string, unknown> = { type: "object", properties: {} };

/**
 * Resolve an Agent's selected tools into model-ready function schemas + a lookup
 * for execution. Only runnable built-in native tools are offered today; anything
 * else is recorded in `notes`.
 */
export async function buildAgentTools(
  toolsSlot: AgentToolsSlot | null,
  workspacePath: string
): Promise<BuiltAgentTools> {
  const schemas: ToolSchema[] = [];
  const lookup = new Map<string, ToolDef>();
  const notes: string[] = [];

  if (!toolsSlot) return { schemas, lookup, notes };

  const selectedNative = Array.isArray(toolsSlot.native) ? toolsSlot.native : [];
  if (selectedNative.length > 0) {
    const available = await toolsService.getAvailable("native", workspacePath);
    const byId = new Map(available.map((t) => [t.id, t]));
    for (const id of selectedNative) {
      const def = byId.get(id);
      if (!def) {
        notes.push(`Native tool "${id}" is selected but no longer available — skipped.`);
        continue;
      }
      if (!RUNNABLE_NATIVE_TOOL_IDS.has(id)) {
        notes.push(`Native tool "${def.label}" has no runtime implementation yet — skipped.`);
        continue;
      }
      schemas.push({
        name: def.id,
        description: def.description || def.label,
        parameters: def.parameters ?? EMPTY_SCHEMA,
      });
      lookup.set(def.id, def);
    }
  }

  const skippedMcp = Array.isArray(toolsSlot.mcp) ? toolsSlot.mcp.length : 0;
  const skippedSkills = Array.isArray(toolsSlot.skills) ? toolsSlot.skills.length : 0;
  if (skippedMcp > 0) {
    notes.push(`${skippedMcp} MCP server(s) selected — MCP execution is not available yet.`);
  }
  if (skippedSkills > 0) {
    notes.push(`${skippedSkills} skill(s) selected — skills execution is not available yet.`);
  }

  return { schemas, lookup, notes };
}

export interface ExecuteToolOptions {
  workspacePath: string;
  /** Credential id bound to web_search (from the Tools slot), if any. */
  webSearchCredentialId?: string | null;
}

/**
 * Execute one tool call. Always resolves (never throws): a tool/runtime error is
 * returned as `{ error }` with a human-readable `content`, so the agent loop can
 * feed it back to the model and let it recover instead of aborting the run.
 */
export async function executeToolCall(
  call: ToolCall,
  lookup: Map<string, ToolDef>,
  opts: ExecuteToolOptions
): Promise<ToolExecResult> {
  const def = lookup.get(call.name);
  if (!def) {
    return { name: call.name, content: `Error: unknown tool "${call.name}".`, error: "unknown tool" };
  }

  let args: Record<string, unknown> = {};
  if (call.arguments && call.arguments.trim() !== "") {
    try {
      args = JSON.parse(call.arguments);
    } catch {
      return {
        name: call.name,
        content: `Error: could not parse arguments for "${call.name}" (expected JSON).`,
        error: "invalid arguments",
      };
    }
  }

  const credentialId =
    call.name === "web_search" ? opts.webSearchCredentialId ?? null : null;

  try {
    const result = await api.runNativeTool(call.name, args, opts.workspacePath, credentialId);
    return { name: call.name, content: result };
  } catch (err) {
    return { name: call.name, content: `Error: ${err}`, error: String(err) };
  }
}
