/**
 * Unit tests for AgentExecutor. Mocks `@/services/api` so no Tauri runtime is
 * needed; drives the executor with a hand-built ExecutionContext whose
 * `updateNodeData` shallow-merges into a store (mirroring runnerSession). Runs
 * under jsdom.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Node, Edge } from "@xyflow/react";

vi.mock("@/services/api", () => ({
  api: {
    llmChat: vi.fn().mockResolvedValue("agent reply"),
  },
}));

import { AgentExecutor } from "@/engine/AgentExecutor";
import { api } from "@/services/api";
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

    await new AgentExecutor().execute(ctx);

    const storage = store[agentId].storage as { records: { content: string }[] };
    expect(storage.records).toHaveLength(1);
    expect(storage.records[0].content).toBe("agent reply");
  });

  it("throws when no LLM slot is configured", async () => {
    const { ctx } = makeHarness({ label: "Agent", llm: null, storage: null, tools: null });
    await expect(new AgentExecutor().execute(ctx)).rejects.toThrow(/LLM/);
  });
});
