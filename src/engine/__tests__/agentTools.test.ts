/**
 * Unit tests for agentTools: resolving selected tools into model schemas
 * (buildAgentTools) and dispatching tool calls (executeToolCall). Mocks
 * `@/services/api` and `@/services/toolsService` so no Tauri runtime is needed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/api", () => ({
  api: { runNativeTool: vi.fn() },
}));
vi.mock("@/services/toolsService", () => ({
  toolsService: { getAvailable: vi.fn() },
}));

import { buildAgentTools, executeToolCall } from "@/engine/agentTools";
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

  const lookup = new Map<string, ToolDef>([
    ["calculator", calculatorDef],
    ["web_search", webSearchDef],
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
