/**
 * Unit tests for agentTools: resolving selected tools into model schemas
 * (buildAgentTools) and dispatching tool calls (executeToolCall). Mocks
 * `@/services/api` and `@/services/toolsService` so no Tauri runtime is needed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/api", () => ({
  api: {
    runNativeTool: vi.fn(),
    mcpListTools: vi.fn(),
    mcpCallTool: vi.fn(),
    runHttpTool: vi.fn(),
    runToolScript: vi.fn(),
    loadSkillContent: vi.fn(),
  },
}));
vi.mock("@/services/toolsService", () => ({
  toolsService: { getAvailable: vi.fn() },
}));
// The dispatch pool-gates MCP/HTTP/script calls; run the task inline in tests.
vi.mock("@/services/concurrency", () => ({
  concurrencyGovernor: { enqueue: (_pool: string, task: () => Promise<unknown>) => task() },
}));

import { buildAgentTools, executeToolCall, type ResolvedTool } from "@/engine/agentTools";
import { api } from "@/services/api";
import { toolsService } from "@/services/toolsService";
import type { ToolCall, ToolDef } from "@/services/api";

const calculatorDef: ToolDef = {
  id: "calculator",
  label: "Calculator",
  description: "Evaluate arithmetic.",
  parameters: {
    type: "object",
    properties: { expression: { type: "string" } },
    required: ["expression"],
  },
};
const webSearchDef: ToolDef = {
  id: "web_search",
  label: "Web Search",
  description: "Search the web.",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
};

describe("buildAgentTools", () => {
  beforeEach(() => vi.mocked(toolsService.getAvailable).mockReset());

  it("returns empty for a null slot (no toolsService call)", async () => {
    const r = await buildAgentTools(null, "/ws");
    expect(r.schemas).toHaveLength(0);
    expect(r.lookup.size).toBe(0);
    expect(toolsService.getAvailable).not.toHaveBeenCalled();
  });

  it("offers runnable built-ins and skips unimplemented user native tools", async () => {
    vi.mocked(toolsService.getAvailable).mockResolvedValue([
      calculatorDef,
      { id: "my_tool", label: "My Tool" },
    ]);
    const r = await buildAgentTools({ native: ["calculator", "my_tool"], mcp: [], skills: [] }, "/ws");
    expect(r.schemas.map((s) => s.name)).toEqual(["calculator"]);
    expect(r.schemas[0].parameters).toEqual(calculatorDef.parameters);
    expect(r.lookup.has("calculator")).toBe(true);
    expect(r.notes.some((n) => n.includes("My Tool"))).toBe(true);
  });

  it("notes selected-but-unsupported mcp servers and skills", async () => {
    vi.mocked(toolsService.getAvailable).mockResolvedValue([]);
    const r = await buildAgentTools({ native: [], mcp: ["server1"], skills: ["s1", "s2"] }, "/ws");
    expect(r.schemas).toHaveLength(0);
    expect(r.notes.some((n) => n.toLowerCase().includes("mcp"))).toBe(true);
    expect(r.notes.some((n) => n.toLowerCase().includes("skill"))).toBe(true);
  });
});

describe("executeToolCall", () => {
  beforeEach(() => vi.mocked(api.runNativeTool).mockReset());

  const lookup = new Map<string, ResolvedTool>([
    ["calculator", { kind: "nativeBuiltin", def: calculatorDef }],
    ["web_search", { kind: "nativeBuiltin", def: webSearchDef }],
  ]);

  it("dispatches a native tool and returns its result", async () => {
    vi.mocked(api.runNativeTool).mockResolvedValue("2");
    const call: ToolCall = { id: "c1", name: "calculator", arguments: '{"expression":"1+1"}' };
    const res = await executeToolCall(call, lookup, { workspacePath: "/ws" });
    expect(res).toEqual({ name: "calculator", content: "2" });
    expect(api.runNativeTool).toHaveBeenCalledWith("calculator", { expression: "1+1" }, "/ws", null);
  });

  it("passes the bound credential only for web_search", async () => {
    vi.mocked(api.runNativeTool).mockResolvedValue("results");
    const call: ToolCall = { id: "c2", name: "web_search", arguments: '{"query":"hive"}' };
    await executeToolCall(call, lookup, { workspacePath: "/ws", webSearchCredentialId: "cred1" });
    expect(api.runNativeTool).toHaveBeenCalledWith("web_search", { query: "hive" }, "/ws", "cred1");
  });

  it("returns an error for an unknown tool", async () => {
    const call: ToolCall = { id: "c3", name: "nope", arguments: "{}" };
    const res = await executeToolCall(call, lookup, { workspacePath: "/ws" });
    expect(res.error).toBeDefined();
    expect(res.content).toContain("unknown tool");
    expect(api.runNativeTool).not.toHaveBeenCalled();
  });

  it("returns an error on invalid argument JSON", async () => {
    const call: ToolCall = { id: "c4", name: "calculator", arguments: "not json" };
    const res = await executeToolCall(call, lookup, { workspacePath: "/ws" });
    expect(res.error).toBe("invalid arguments");
    expect(api.runNativeTool).not.toHaveBeenCalled();
  });

  it("surfaces a tool runtime failure as an error result (does not throw)", async () => {
    // Reject only when the mock is actually called (no eagerly-created promise).
    vi.mocked(api.runNativeTool).mockImplementationOnce(() => Promise.reject(new Error("boom")));
    const call: ToolCall = { id: "c5", name: "calculator", arguments: '{"expression":"1/0"}' };
    const res = await executeToolCall(call, lookup, { workspacePath: "/ws" });
    expect(res.error).toContain("boom");
    expect(res.content).toContain("Error");
  });
});

describe("buildAgentTools — MCP, skills, user tools", () => {
  beforeEach(() => {
    vi.mocked(toolsService.getAvailable).mockReset();
    vi.mocked(api.mcpListTools).mockReset();
  });

  it("discovers and namespaces MCP server tools", async () => {
    const serverDef: ToolDef = {
      id: "srv",
      label: "Server",
      mcp: { transport: "stdio", command: "x" },
    };
    vi.mocked(toolsService.getAvailable).mockImplementation(async (cat) =>
      cat === "mcp" ? [serverDef] : []
    );
    vi.mocked(api.mcpListTools).mockResolvedValue([
      { name: "add", description: "Adds", parameters: { type: "object", properties: {} } },
    ]);
    const r = await buildAgentTools({ native: [], mcp: ["srv"], skills: [] }, "/ws");
    expect(r.schemas.map((s) => s.name)).toEqual(["mcp__srv__add"]);
    expect(r.lookup.get("mcp__srv__add")).toMatchObject({
      kind: "mcp",
      serverId: "srv",
      toolName: "add",
    });
    expect(api.mcpListTools).toHaveBeenCalledWith("/ws", "srv");
  });

  it("notes an unreachable MCP server without throwing", async () => {
    const serverDef: ToolDef = {
      id: "srv",
      label: "Server",
      mcp: { transport: "stdio", command: "x" },
    };
    vi.mocked(toolsService.getAvailable).mockImplementation(async (cat) =>
      cat === "mcp" ? [serverDef] : []
    );
    vi.mocked(api.mcpListTools).mockRejectedValue(new Error("spawn failed"));
    const r = await buildAgentTools({ native: [], mcp: ["srv"], skills: [] }, "/ws");
    expect(r.schemas).toHaveLength(0);
    expect(r.notes.some((n) => n.includes("could not be reached"))).toBe(true);
  });

  it("offers user HTTP and script tools by config presence", async () => {
    const httpDef: ToolDef = {
      id: "weather",
      label: "Weather",
      http: { url: "https://x" },
      parameters: { type: "object", properties: {} },
    };
    const scriptDef: ToolDef = { id: "munge", label: "Munge", script: { runtime: "js" } };
    vi.mocked(toolsService.getAvailable).mockImplementation(async (cat) =>
      cat === "native" ? [httpDef, scriptDef] : []
    );
    const r = await buildAgentTools({ native: ["weather", "munge"], mcp: [], skills: [] }, "/ws");
    expect(r.lookup.get("weather")).toMatchObject({ kind: "httpTool" });
    expect(r.lookup.get("munge")).toMatchObject({ kind: "scriptTool" });
    expect(r.schemas.map((s) => s.name).sort()).toEqual(["munge", "weather"]);
  });

  it("builds a skill catalog + a single load_skill tool", async () => {
    const skillDef: ToolDef = { id: "writing", label: "Writing", description: "How to write well" };
    vi.mocked(toolsService.getAvailable).mockImplementation(async (cat) =>
      cat === "skills" ? [skillDef] : []
    );
    const r = await buildAgentTools({ native: [], mcp: [], skills: ["writing"] }, "/ws");
    expect(r.skillCatalog).toContain("writing");
    const loadSkill = r.schemas.find((s) => s.name === "load_skill");
    expect(loadSkill).toBeDefined();
    expect((loadSkill!.parameters as { properties: { skill_id: { enum: string[] } } }).properties.skill_id.enum).toEqual([
      "writing",
    ]);
    expect(r.lookup.get("load_skill")).toMatchObject({ kind: "loadSkill" });
  });
});

describe("executeToolCall — MCP / HTTP / script / load_skill", () => {
  beforeEach(() => {
    vi.mocked(api.mcpCallTool).mockReset();
    vi.mocked(api.runHttpTool).mockReset();
    vi.mocked(api.runToolScript).mockReset();
    vi.mocked(api.loadSkillContent).mockReset();
  });

  it("dispatches an MCP tool to mcpCallTool with the original tool name", async () => {
    vi.mocked(api.mcpCallTool).mockResolvedValue("3");
    const lookup = new Map<string, ResolvedTool>([
      [
        "mcp__srv__add",
        { kind: "mcp", serverId: "srv", toolName: "add", def: { id: "srv", label: "S" } },
      ],
    ]);
    const call: ToolCall = { id: "1", name: "mcp__srv__add", arguments: '{"a":1,"b":2}' };
    const res = await executeToolCall(call, lookup, { workspacePath: "/ws" });
    expect(res.content).toBe("3");
    expect(api.mcpCallTool).toHaveBeenCalledWith("/ws", "srv", "add", { a: 1, b: 2 });
  });

  it("dispatches HTTP and script tools to their commands", async () => {
    vi.mocked(api.runHttpTool).mockResolvedValue("sunny");
    vi.mocked(api.runToolScript).mockResolvedValue("munged");
    const lookup = new Map<string, ResolvedTool>([
      ["weather", { kind: "httpTool", def: { id: "weather", label: "W" } }],
      ["munge", { kind: "scriptTool", def: { id: "munge", label: "M" } }],
    ]);
    const r1 = await executeToolCall(
      { id: "1", name: "weather", arguments: '{"q":"x"}' },
      lookup,
      { workspacePath: "/ws" }
    );
    expect(r1.content).toBe("sunny");
    expect(api.runHttpTool).toHaveBeenCalledWith("/ws", "weather", { q: "x" });
    const r2 = await executeToolCall({ id: "2", name: "munge", arguments: "{}" }, lookup, {
      workspacePath: "/ws",
    });
    expect(r2.content).toBe("munged");
    expect(api.runToolScript).toHaveBeenCalledWith("/ws", "munge", {});
  });

  it("load_skill returns content for a granted id and rejects others", async () => {
    vi.mocked(api.loadSkillContent).mockResolvedValue("# Writing\nBe concise.");
    const lookup = new Map<string, ResolvedTool>([
      ["load_skill", { kind: "loadSkill", allowedSkillIds: new Set(["writing"]) }],
    ]);
    const ok = await executeToolCall(
      { id: "1", name: "load_skill", arguments: '{"skill_id":"writing"}' },
      lookup,
      { workspacePath: "/ws" }
    );
    expect(ok.content).toContain("Be concise");
    expect(api.loadSkillContent).toHaveBeenCalledWith("/ws", "writing");

    const bad = await executeToolCall(
      { id: "2", name: "load_skill", arguments: '{"skill_id":"nope"}' },
      lookup,
      { workspacePath: "/ws" }
    );
    expect(bad.error).toBe("unknown skill");
    expect(api.loadSkillContent).toHaveBeenCalledTimes(1);
  });
});
