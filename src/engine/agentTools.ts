// Agent tool resolution + dispatch. Turns an Agent's selected tools into
// model-ready function schemas (offered to the LLM) and executes the tool calls
// the model requests. Execution happens server-side (Rust commands); the renderer
// only supplies references (tool/server id + tool name) + the model's arguments —
// never a command line, URL, or secret (disk is authoritative for grants).
//
// `buildAgentTools` is the discovery/namespacing point: it resolves each selected
// tool into a `ResolvedTool` (how it runs) keyed by the schema name offered to the
// model. `executeToolCall` is a switch over that kind. The union grows per tool
// kind — native built-ins (here), MCP, skills, and user HTTP/script tools. See
// docs/agent-node.md.

import { api, type ToolCall, type ToolDef, type ToolSchema } from "@/services/api";
import { toolsService } from "@/services/toolsService";
import { concurrencyGovernor } from "@/services/concurrency";
import { RUNNABLE_NATIVE_TOOL_IDS, builtinNeedsCredential } from "@/services/builtInTools";
import type { MemoryHandler } from "./agentMemory";
import type { AgentToolsSlot } from "@/nodes/types";

/**
 * A selected tool resolved to how it executes. The agent's lookup maps the schema
 * name offered to the model → the dispatch info `executeToolCall` needs.
 *   - `nativeBuiltin` — calculator / current_time / web_search (Rust run_native_tool)
 *   - `mcp`           — a tool discovered from an MCP server (Rust mcp_call_tool)
 *   - `httpTool`      — a user declarative HTTP tool (Rust run_http_tool)
 *   - `scriptTool`    — a user sandboxed-script tool (Rust run_tool_script)
 *   - `loadSkill`     — the single built-in tool that returns a skill's SKILL.md
 *   - `memory`        — read/write the agent's own Storage slot (renderer-side)
 */
export type ResolvedTool =
  | { kind: "nativeBuiltin"; def: ToolDef }
  | { kind: "mcp"; serverId: string; toolName: string; def: ToolDef }
  | { kind: "httpTool"; def: ToolDef }
  | { kind: "scriptTool"; def: ToolDef }
  | { kind: "loadSkill"; allowedSkillIds: Set<string> }
  | { kind: "memory"; op: "save" | "search" | "list" };

export interface BuiltAgentTools {
  /** Function schemas to offer the model. Empty ⇒ the agent runs a single inference. */
  schemas: ToolSchema[];
  /** Map of schema name → how to execute that call. */
  lookup: Map<string, ResolvedTool>;
  /** Human-readable notes about selected-but-skipped tools (shown in the run log). */
  notes: string[];
  /** Catalog (name — description) of selected skills, injected into the system prompt. */
  skillCatalog: string;
}

export interface ToolExecResult {
  name: string;
  content: string;
  /** Set when the tool failed; `content` then holds a human-readable error. */
  error?: string;
  /** `ctx.log(...)` lines emitted by a script tool, surfaced in the Agent's Logs. */
  logs?: string[];
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

/** The single built-in tool that returns a selected skill's full SKILL.md. */
const LOAD_SKILL_TOOL = "load_skill";

/** Built-in memory tool names, offered when the agent has a Storage slot. */
const MEMORY_SAVE_TOOL = "memory_save";
const MEMORY_SEARCH_TOOL = "memory_search";
const MEMORY_LIST_TOOL = "memory_list";

/** Append the agent's memory tools (read/write its own Storage slot) to a built
 * set. Offered only when the agent has a Storage slot (see {@link buildAgentTools}). */
function addMemoryTools(schemas: ToolSchema[], lookup: Map<string, ResolvedTool>): void {
  schemas.push({
    name: MEMORY_SAVE_TOOL,
    description:
      "Save a fact to your persistent memory so you can recall it in future runs. Use for durable facts (names, preferences, decisions), not for transient reasoning.",
    parameters: {
      type: "object",
      properties: { content: { type: "string", description: "The fact to remember." } },
      required: ["content"],
    },
  });
  schemas.push({
    name: MEMORY_SEARCH_TOOL,
    description: "Search your persistent memory for entries matching a query (newest first).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to search your memory for." },
        limit: { type: "number", description: "Max entries to return (default 10)." },
      },
      required: ["query"],
    },
  });
  schemas.push({
    name: MEMORY_LIST_TOOL,
    description: "List your most recent persistent-memory entries (newest first).",
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "Max entries to return (default 10)." } },
    },
  });
  lookup.set(MEMORY_SAVE_TOOL, { kind: "memory", op: "save" });
  lookup.set(MEMORY_SEARCH_TOOL, { kind: "memory", op: "search" });
  lookup.set(MEMORY_LIST_TOOL, { kind: "memory", op: "list" });
}

/** Build the model-facing function schema for a registry tool. */
function toSchema(def: ToolDef): ToolSchema {
  return {
    name: def.id,
    description: def.description || def.label,
    parameters: def.parameters ?? EMPTY_SCHEMA,
  };
}

/**
 * A provider-safe, unique function name for an MCP tool. OpenAI restricts tool
 * names to `^[A-Za-z0-9_-]{1,64}$` (no `:`), so we namespace as
 * `mcp__<server>__<tool>`, sanitize, cap at 64, and de-dupe against `taken`.
 * The model echoes this exact name back, so the lookup round-trips.
 */
function mcpSchemaName(serverId: string, toolName: string, taken: Set<string>): string {
  let base = `mcp__${serverId}__${toolName}`.replace(/[^A-Za-z0-9_-]/g, "_");
  if (base.length > 64) base = base.slice(0, 64);
  let name = base;
  let i = 1;
  while (taken.has(name)) {
    const suffix = `_${i++}`;
    name = base.slice(0, 64 - suffix.length) + suffix;
  }
  taken.add(name);
  return name;
}

/**
 * Resolve an Agent's selected tools into model-ready function schemas + a lookup
 * for execution. Built-in native tools resolve here; MCP / skills / user HTTP +
 * script tools are layered in by their respective phases (see docs/agent-node.md).
 * Anything not yet runnable is recorded in `notes` rather than offered.
 */
export async function buildAgentTools(
  toolsSlot: AgentToolsSlot | null,
  workspacePath: string,
  opts: { hasMemory?: boolean } = {}
): Promise<BuiltAgentTools> {
  const schemas: ToolSchema[] = [];
  const lookup = new Map<string, ResolvedTool>();
  const notes: string[] = [];
  let skillCatalog = "";

  // Memory tools are offered whenever the agent has a Storage slot, independent of
  // the Tools slot — an agent can have memory without any other tools.
  if (opts.hasMemory) addMemoryTools(schemas, lookup);

  if (!toolsSlot) return { schemas, lookup, notes, skillCatalog };

  // ── Native tools: built-in runnable ones offered directly. User HTTP/script
  //    tools are wired in Phase C; bare user tools (no impl) are skipped. ──
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
      if (RUNNABLE_NATIVE_TOOL_IDS.has(id)) {
        schemas.push(toSchema(def));
        lookup.set(def.id, { kind: "nativeBuiltin", def });
      } else if (def.http) {
        schemas.push(toSchema(def));
        lookup.set(def.id, { kind: "httpTool", def });
      } else if (def.script) {
        schemas.push(toSchema(def));
        lookup.set(def.id, { kind: "scriptTool", def });
      } else {
        notes.push(
          `Native tool "${def.label}" has no HTTP or script implementation configured — skipped.`
        );
      }
    }
  }

  // ── MCP servers: connect + discover each server's tools, namespaced so the
  //    model can call them. Discovery runs server-side (process spawn / network);
  //    a server that's unavailable is noted, not fatal. ──
  const selectedMcp = Array.isArray(toolsSlot.mcp) ? toolsSlot.mcp : [];
  if (selectedMcp.length > 0) {
    const availableMcp = await toolsService.getAvailable("mcp", workspacePath);
    const byId = new Map(availableMcp.map((t) => [t.id, t]));
    const taken = new Set(schemas.map((s) => s.name));
    for (const id of selectedMcp) {
      const def = byId.get(id);
      if (!def) {
        notes.push(`MCP server "${id}" is selected but no longer available — skipped.`);
        continue;
      }
      if (!def.mcp) {
        notes.push(`MCP server "${def.label}" has no connection configured — skipped.`);
        continue;
      }
      try {
        const discovered = await api.mcpListTools(workspacePath, id);
        if (discovered.length === 0) {
          notes.push(`MCP server "${def.label}" exposed no tools.`);
          continue;
        }
        for (const tool of discovered) {
          const schemaName = mcpSchemaName(id, tool.name, taken);
          schemas.push({
            name: schemaName,
            description: tool.description || `${def.label}: ${tool.name}`,
            parameters: tool.parameters ?? EMPTY_SCHEMA,
          });
          lookup.set(schemaName, { kind: "mcp", serverId: id, toolName: tool.name, def });
        }
        notes.push(`MCP server "${def.label}": ${discovered.length} tool(s) available.`);
      } catch (err) {
        notes.push(`MCP server "${def.label}" could not be reached: ${err}`);
      }
    }
  }

  // ── Skills: progressive disclosure. Inject a short catalog (id — description)
  //    into the system prompt and offer ONE load_skill tool whose enum is the
  //    selected skills; the model calls it to read a skill's full SKILL.md. ──
  const selectedSkills = Array.isArray(toolsSlot.skills) ? toolsSlot.skills : [];
  if (selectedSkills.length > 0) {
    const availableSkills = await toolsService.getAvailable("skills", workspacePath);
    const byId = new Map(availableSkills.map((t) => [t.id, t]));
    const present: { id: string; description: string }[] = [];
    for (const id of selectedSkills) {
      const def = byId.get(id);
      if (!def) {
        notes.push(`Skill "${id}" is selected but no longer available — skipped.`);
        continue;
      }
      present.push({ id, description: def.description || def.label });
    }
    if (present.length > 0) {
      skillCatalog = present.map((s) => `- ${s.id}: ${s.description}`).join("\n");
      schemas.push({
        name: LOAD_SKILL_TOOL,
        description:
          "Load the full instructions for one of the available skills by id. Call this when a skill is relevant, then follow its instructions.",
        parameters: {
          type: "object",
          properties: {
            skill_id: {
              type: "string",
              enum: present.map((s) => s.id),
              description: "The id of the skill to load.",
            },
          },
          required: ["skill_id"],
        },
      });
      lookup.set(LOAD_SKILL_TOOL, {
        kind: "loadSkill",
        allowedSkillIds: new Set(present.map((s) => s.id)),
      });
    }
  }

  return { schemas, lookup, notes, skillCatalog };
}

export interface ExecuteToolOptions {
  workspacePath: string;
  /** Vault credential ids bound to credential-requiring built-in tools, keyed by
   * tool name (e.g. `{ web_search: "cred_…" }`). Resolved server-side by id. */
  builtinCredentialIds?: Record<string, string | null>;
  /** Memory access for the memory_* tools (present when the agent has a Storage slot). */
  memory?: MemoryHandler;
}

/**
 * Execute one tool call. Always resolves (never throws): a tool/runtime error is
 * returned as `{ error }` with a human-readable `content`, so the agent loop can
 * feed it back to the model and let it recover instead of aborting the run.
 */
export async function executeToolCall(
  call: ToolCall,
  lookup: Map<string, ResolvedTool>,
  opts: ExecuteToolOptions
): Promise<ToolExecResult> {
  const resolved = lookup.get(call.name);
  if (!resolved) {
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

  try {
    switch (resolved.kind) {
      case "nativeBuiltin": {
        // Credential-requiring built-ins (e.g. web_search) are network-bound, so
        // they're pool-gated and get their bound credential; calculator/current_time
        // are pure compute and run ungated with no credential.
        if (builtinNeedsCredential(call.name)) {
          const credentialId = opts.builtinCredentialIds?.[call.name] ?? null;
          const result = await concurrencyGovernor.enqueue("general", () =>
            api.runNativeTool(call.name, args, opts.workspacePath, credentialId)
          );
          return { name: call.name, content: result };
        }
        const result = await api.runNativeTool(call.name, args, opts.workspacePath, null);
        return { name: call.name, content: result };
      }
      // Network/process-bound kinds run through the shared "general" pool so
      // multi-tool loops (and multiple background agents) respect the configured
      // concurrency limits — mirroring how LLM turns are pool-gated.
      case "mcp": {
        const result = await concurrencyGovernor.enqueue("general", () =>
          api.mcpCallTool(opts.workspacePath, resolved.serverId, resolved.toolName, args)
        );
        return { name: call.name, content: result };
      }
      case "httpTool": {
        const result = await concurrencyGovernor.enqueue("general", () =>
          api.runHttpTool(opts.workspacePath, resolved.def.id, args)
        );
        return { name: call.name, content: result };
      }
      case "scriptTool": {
        const { output, logs } = await concurrencyGovernor.enqueue("general", () =>
          api.runToolScript(opts.workspacePath, resolved.def.id, args)
        );
        return { name: call.name, content: output, logs };
      }
      case "loadSkill": {
        const skillId = typeof args.skill_id === "string" ? args.skill_id : "";
        if (!skillId || !resolved.allowedSkillIds.has(skillId)) {
          return {
            name: call.name,
            content: `Error: unknown skill "${skillId}". Available: ${[
              ...resolved.allowedSkillIds,
            ].join(", ")}.`,
            error: "unknown skill",
          };
        }
        const content = await api.loadSkillContent(opts.workspacePath, skillId);
        return {
          name: call.name,
          content: content || `Skill "${skillId}" has no instructions yet.`,
        };
      }
      case "memory": {
        if (!opts.memory) {
          return { name: call.name, content: "Error: this agent has no memory.", error: "no memory" };
        }
        if (resolved.op === "save") {
          const content = typeof args.content === "string" ? args.content.trim() : "";
          if (!content) {
            return {
              name: call.name,
              content: "Error: memory_save requires a non-empty 'content'.",
              error: "invalid arguments",
            };
          }
          return { name: call.name, content: opts.memory.save(content) };
        }
        if (resolved.op === "search") {
          const query = typeof args.query === "string" ? args.query : "";
          const limit = typeof args.limit === "number" ? args.limit : undefined;
          return { name: call.name, content: opts.memory.search(query, limit) };
        }
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        return { name: call.name, content: opts.memory.list(limit) };
      }
      default:
        return {
          name: call.name,
          content: `Error: tool "${call.name}" is not runnable.`,
          error: "not runnable",
        };
    }
  } catch (err) {
    return { name: call.name, content: `Error: ${err}`, error: String(err) };
  }
}
