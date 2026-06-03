/**
 * Unit tests for AgentExecutor. Mocks `@/services/api` and `@/services/toolsService`
 * so no Tauri runtime is needed; drives the executor with a hand-built
 * ExecutionContext whose `updateNodeData` shallow-merges into a store (mirroring
 * runnerSession). Runs under jsdom.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Node, Edge } from "@xyflow/react";

vi.mock("@/services/api", () => ({
  api: {
    llmChat: vi.fn().mockResolvedValue("agent reply"),
    llmChatTools: vi.fn(),
    runNativeTool: vi.fn(),
  },
}));
vi.mock("@/services/toolsService", () => ({
  toolsService: { getAvailable: vi.fn() },
}));

import { AgentExecutor, MAX_AGENT_ITERATIONS } from "@/engine/AgentExecutor";
import { api } from "@/services/api";
import { toolsService } from "@/services/toolsService";
import { BUILT_IN_NATIVE_TOOLS } from "@/services/builtInTools";
import type { ExecutionContext } from "@/engine/types";

const LLM_SLOT = {
  provider: "Ollama",
  modelName: "llama3",
  baseURL: "http://localhost:11434",
  systemPrompt: "",
  temperature: 0.7,
  maxTokens: 512,
  chatHistoryLimit: 0,
};

function makeHarness(agentData: Record<string, unknown>) {
  const agentId = "agent1";
  const upstreamId = "up1";
  const nodes: Node[] = [
    {
      id: upstreamId,
      type: "test-source",
      position: { x: 0, y: 0 },
      data: { outputEnvelope: { value: "hello" } },
    },
    { id: agentId, type: "agent", position: { x: 0, y: 0 }, data: agentData },
  ];
  const edges: Edge[] = [{ id: "e1", source: upstreamId, target: agentId }];
  const store: Record<string, Record<string, unknown>> = {
    [upstreamId]: nodes[0].data,
    [agentId]: nodes[1].data,
  };
  const updateNodeData = (id: string, data: Record<string, unknown>) => {
    store[id] = { ...store[id], ...data };
    const n = nodes.find((nn) => nn.id === id);
    if (n) n.data = store[id];
  };
  const ctx: ExecutionContext = {
    node: nodes[1],
    nodes,
    edges,
    updateNodeData,
    showToast: () => {},
    visited: new Set([upstreamId]),
    workspacePath: "/ws",
  };
  return { ctx, store, agentId };
}

describe("AgentExecutor", () => {
  beforeEach(() => {
    vi.mocked(api.llmChat).mockClear();
    vi.mocked(api.llmChat).mockResolvedValue("agent reply");
    vi.mocked(api.llmChatTools).mockReset();
    vi.mocked(api.runNativeTool).mockReset();
    vi.mocked(toolsService.getAvailable).mockReset();
    vi.mocked(toolsService.getAvailable).mockResolvedValue(BUILT_IN_NATIVE_TOOLS);
  });

  it("runs the LLM slot and writes the output envelope", async () => {
    const { ctx, store, agentId } = makeHarness({
      label: "Agent",
      llm: { ...LLM_SLOT },
      storage: null,
      tools: null,
    });

    await new AgentExecutor().execute(ctx);

    expect(api.llmChat).toHaveBeenCalledTimes(1);
    const env = store[agentId].outputEnvelope as { value: string };
    expect(env.value).toBe("agent reply");
  });

  it("feeds upstream input to the model as a user message", async () => {
    const { ctx } = makeHarness({
      label: "Agent",
      llm: { ...LLM_SLOT },
      storage: null,
      tools: null,
    });

    await new AgentExecutor().execute(ctx);

    const messages = vi.mocked(api.llmChat).mock.calls[0][3] as {
      role: string;
      content: string;
    }[];
    expect(messages.some((m) => m.role === "user" && m.content === "hello")).toBe(true);
  });

  it("appends the result to the storage slot when present", async () => {
    const { ctx, store, agentId } = makeHarness({
      label: "Agent",
      llm: { ...LLM_SLOT },
      storage: { kind: "jsonStorage", records: [] },
      tools: null,
    });
    // A Storage slot makes the agent memory-capable, so it runs the tool loop (to
    // offer the memory_* tools) even with no Tools slot. Final turn = no tool calls.
    vi.mocked(api.llmChatTools).mockResolvedValue({
      content: "agent reply",
      tool_calls: [],
      finish_reason: "stop",
    });

    await new AgentExecutor().execute(ctx);

    const storage = store[agentId].storage as { records: { content: string }[] };
    expect(storage.records).toHaveLength(1);
    expect(storage.records[0].content).toBe("agent reply");
  });

  it("offers memory tools and persists a memory_save into storage", async () => {
    const { ctx, store, agentId } = makeHarness({
      label: "Agent",
      llm: { ...LLM_SLOT },
      storage: { kind: "jsonStorage", records: [] },
      tools: null,
    });
    // First turn saves a memory, second turn finalizes. memory_* runs renderer-side.
    vi.mocked(api.llmChatTools)
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [{ id: "m1", name: "memory_save", arguments: '{"content":"my name is Roshan"}' }],
        finish_reason: "tool_calls",
      })
      .mockResolvedValueOnce({ content: "Noted.", tool_calls: [], finish_reason: "stop" });

    await new AgentExecutor().execute(ctx);

    // memory_save ran renderer-side (proving the memory tool was offered + dispatched):
    // the saved memory + the final answer are both persisted (save runs before the append).
    const storage = store[agentId].storage as { records: { content: string }[] };
    expect(storage.records.map((r) => r.content)).toEqual(["my name is Roshan", "Noted."]);
  });

  it("runs unbounded when the limit is off and halts on cancellation", async () => {
    const { ctx, store, agentId } = makeHarness({
      label: "Agent",
      llm: { ...LLM_SLOT },
      storage: null,
      tools: {
        native: ["calculator"],
        mcp: [],
        skills: [],
        toolSettings: { limitToolRounds: false },
      },
    });

    // The model never finalizes — only cancellation can stop the (unbounded) loop.
    vi.mocked(api.llmChatTools).mockResolvedValue({
      content: null,
      tool_calls: [{ id: "c", name: "calculator", arguments: "{}" }],
      finish_reason: "tool_calls",
    });
    vi.mocked(api.runNativeTool).mockResolvedValue("ok");
    // Cancel before the 4th round (checked at the top of each iteration, pre-LLM-call).
    ctx.isCancelled = () => vi.mocked(api.llmChatTools).mock.calls.length >= 3;

    await new AgentExecutor().execute(ctx);

    // Well past MAX_AGENT_ITERATIONS (10) would run forever if unbounded weren't honored;
    // cancellation stops it at 3 rounds.
    expect(api.llmChatTools).toHaveBeenCalledTimes(3);
    const env = store[agentId].outputEnvelope as { value: string };
    expect(env.value.toLowerCase()).toContain("cancel");
  });

  it("throws when no LLM slot is configured", async () => {
    const { ctx } = makeHarness({ label: "Agent", llm: null, storage: null, tools: null });
    await expect(new AgentExecutor().execute(ctx)).rejects.toThrow(/LLM/);
  });

  it("does not call the tool-calling path when no tools are selected", async () => {
    const { ctx } = makeHarness({
      label: "Agent",
      llm: { ...LLM_SLOT },
      storage: null,
      tools: null,
    });

    await new AgentExecutor().execute(ctx);

    expect(api.llmChat).toHaveBeenCalledTimes(1);
    expect(api.llmChatTools).not.toHaveBeenCalled();
  });

  it("invokes a requested tool and feeds the result back to the model", async () => {
    const { ctx, store, agentId } = makeHarness({
      label: "Agent",
      llm: { ...LLM_SLOT },
      storage: { kind: "jsonStorage", records: [] },
      tools: { native: ["calculator"], mcp: [], skills: [] },
    });

    vi.mocked(api.llmChatTools)
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [{ id: "c1", name: "calculator", arguments: '{"expression":"(2+3)*7"}' }],
        finish_reason: "tool_calls",
      })
      .mockResolvedValueOnce({ content: "The answer is 35.", tool_calls: [], finish_reason: "stop" });
    vi.mocked(api.runNativeTool).mockResolvedValue("35");

    await new AgentExecutor().execute(ctx);

    // Two model turns: request tools, then produce the final answer.
    expect(api.llmChatTools).toHaveBeenCalledTimes(2);
    expect(api.llmChat).not.toHaveBeenCalled();
    expect(api.runNativeTool).toHaveBeenCalledWith(
      "calculator",
      { expression: "(2+3)*7" },
      "/ws",
      null
    );

    // The second turn's message history carries the assistant tool-call turn + tool result.
    const secondTurnMessages = vi.mocked(api.llmChatTools).mock.calls[1][3] as {
      role: string;
      content?: string | null;
      tool_calls?: unknown[];
    }[];
    expect(secondTurnMessages.some((m) => m.role === "tool" && m.content === "35")).toBe(true);
    expect(
      secondTurnMessages.some((m) => m.role === "assistant" && Array.isArray(m.tool_calls))
    ).toBe(true);

    const env = store[agentId].outputEnvelope as {
      value: string;
      data: { toolTrace: { name: string; content: string }[] };
    };
    expect(env.value).toBe("The answer is 35.");
    expect(env.data.toolTrace).toHaveLength(1);
    expect(env.data.toolTrace[0]).toMatchObject({ name: "calculator", content: "35" });

    // Final answer is appended to memory; the run log records the tool call.
    const storage = store[agentId].storage as { records: { content: string }[] };
    expect(storage.records[0].content).toBe("The answer is 35.");
    const logs = store[agentId].logs as string[];
    expect(logs.some((l) => l.includes("calculator"))).toBe(true);
  });

  it("stops at the maximum iteration cap when the model never finalizes", async () => {
    const { ctx, store, agentId } = makeHarness({
      label: "Agent",
      llm: { ...LLM_SLOT },
      storage: null,
      tools: { native: ["calculator"], mcp: [], skills: [] },
    });

    // Always asks for another tool call — must be bounded by the cap.
    vi.mocked(api.llmChatTools).mockResolvedValue({
      content: null,
      tool_calls: [{ id: "c", name: "calculator", arguments: "{}" }],
      finish_reason: "tool_calls",
    });
    vi.mocked(api.runNativeTool).mockResolvedValue("ok");

    await new AgentExecutor().execute(ctx);

    expect(api.llmChatTools).toHaveBeenCalledTimes(MAX_AGENT_ITERATIONS);
    const env = store[agentId].outputEnvelope as { value: string };
    expect(env.value).toContain("maximum number of tool-call iterations");
  });
});
