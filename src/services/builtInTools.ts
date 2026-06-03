import type { ToolDef } from "./api";
import type { AgentToolSettings } from "@/nodes/types";

// Built-in tools always available in the Tools picker (not persisted to disk),
// mirroring builtInModels. Users add their own native tools / MCP servers /
// skills on top at global or workspace scope. The built-in *native* tools are
// runnable today (executed server-side via `run_native_tool`); their `parameters`
// JSON Schema is what's offered to the model. See docs/agent-node.md.
//
// `web_search` requires a Brave Search API credential bound in the Agent's Tools
// slot (resolved Rust-side); calculator/current_time are pure compute.

export const BUILT_IN_NATIVE_TOOLS: ToolDef[] = [
  {
    id: "web_search",
    label: "Brave Web Search",
    icon: "🔎",
    description: "Search the web with Brave and return the top results (title, URL, snippet).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
      },
      required: ["query"],
    },
  },
  {
    id: "calculator",
    label: "Calculator",
    icon: "🧮",
    description: "Evaluate an arithmetic expression and return the numeric result.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "An arithmetic expression to evaluate, e.g. (2 + 3) * 7.",
        },
      },
      required: ["expression"],
    },
  },
  {
    id: "current_time",
    label: "Current Time",
    icon: "🕐",
    description: "Get the current date and time as an ISO-8601 (UTC) string.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

/** Ids of the built-in native tools that have a real server-side implementation. */
export const RUNNABLE_NATIVE_TOOL_IDS = new Set(
  BUILT_IN_NATIVE_TOOLS.map((t) => t.id)
);

/**
 * Built-in native tools that need a vault credential to run, and the credential
 * schema type they accept (keyed by tool id). This is the **single source of truth**
 * for "which built-in needs a key" — the agent surfaces (card badge, config modal,
 * executor, pool-gating) all read it instead of hardcoding tool ids. Add a future
 * credential-requiring built-in here and the UI + dispatch pick it up automatically.
 */
export const BUILTIN_CREDENTIAL_REQUIREMENTS: Record<string, { schemaType: string }> = {
  web_search: { schemaType: "webSearch" },
};

/** The credential schema type a built-in tool requires, or null if it needs none. */
export function builtinCredentialSchema(id: string): string | null {
  return BUILTIN_CREDENTIAL_REQUIREMENTS[id]?.schemaType ?? null;
}

/** Whether a built-in tool requires a vault credential to run (also implies it is
 * network-bound, so the executor pool-gates it). */
export function builtinNeedsCredential(id: string): boolean {
  return id in BUILTIN_CREDENTIAL_REQUIREMENTS;
}

/**
 * Resolve the credential id an agent has bound to a built-in tool. Reads the
 * generalized `credentialIds` map first, then falls back to the legacy
 * `webSearchCredentialId` field so agents saved before the generalization keep
 * working. Returns null when nothing is bound.
 */
export function getBuiltinCredentialId(
  toolSettings: AgentToolSettings | undefined,
  id: string
): string | null {
  const fromMap = toolSettings?.credentialIds?.[id];
  if (fromMap) return fromMap;
  if (id === "web_search" && toolSettings?.webSearchCredentialId) {
    return toolSettings.webSearchCredentialId;
  }
  return null;
}

/**
 * Whether a selected tool actually executes, given its def + category. Built-in
 * natives always run; a user native tool runs once it carries HTTP or script
 * config; an MCP server runs once it has connection config; a skill always runs
 * (the agent reads it via the built-in load_skill tool). Drives the card badges
 * in the Tools selector. See docs/agent-node.md.
 */
export function isToolRunnable(category: ToolCategory, def: ToolDef): boolean {
  if (category === "native") {
    return RUNNABLE_NATIVE_TOOL_IDS.has(def.id) || Boolean(def.http || def.script);
  }
  if (category === "mcp") return Boolean(def.mcp);
  if (category === "skills") return true;
  return false;
}

/** Fallback card icon for a tool that declares none, by category. */
export function categoryIcon(category: ToolCategory): string {
  if (category === "native") return "🔧";
  if (category === "mcp") return "🔌";
  return "✨";
}

export const BUILT_IN_MCP_SERVERS: ToolDef[] = [];

export const BUILT_IN_SKILLS: ToolDef[] = [];

export type ToolCategory = "native" | "mcp" | "skills";

export function builtInToolsFor(category: ToolCategory): ToolDef[] {
  if (category === "native") return BUILT_IN_NATIVE_TOOLS;
  if (category === "mcp") return BUILT_IN_MCP_SERVERS;
  return BUILT_IN_SKILLS;
}
