import type { ToolDef } from "./api";

// Built-in tools always available in the Tools picker (not persisted to disk),
// mirroring builtInModels. Users add their own native tools / MCP servers /
// skills on top at global or workspace scope. These are placeholders for the
// deferred runtime-invocation work — selecting them persists the reference but
// does not yet invoke anything (see docs/agent-node.md).

export const BUILT_IN_NATIVE_TOOLS: ToolDef[] = [
  { id: "web_search", label: "Web Search", description: "Search the web for information." },
  { id: "calculator", label: "Calculator", description: "Evaluate arithmetic expressions." },
  { id: "current_time", label: "Current Time", description: "Get the current date and time." },
];

export const BUILT_IN_MCP_SERVERS: ToolDef[] = [];

export const BUILT_IN_SKILLS: ToolDef[] = [];

export type ToolCategory = "native" | "mcp" | "skills";

export function builtInToolsFor(category: ToolCategory): ToolDef[] {
  if (category === "native") return BUILT_IN_NATIVE_TOOLS;
  if (category === "mcp") return BUILT_IN_MCP_SERVERS;
  return BUILT_IN_SKILLS;
}
