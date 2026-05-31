/**
 * Integration tests for the workflow run loop currently embedded in
 * `src/contexts/runnerSession.ts::runWorkflow`. These exist to guard the Tier 1
 * extraction of that loop into a standalone `src/engine/runLoop.ts` — any
 * behavior change there should fail one of these tests.
 *
 * The tests register minimal test-only plugins on the real `pluginRegistry`
 * (no React inspectors), mock `@/services/api` so no Tauri runtime is needed,
 * and drive the session via its public `executeWorkflow` / `cancelWorkflow`
 * surface. They run under jsdom.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Node, Edge } from "@xyflow/react";

vi.mock("@/services/api", () => ({
  api: {
    saveSpace: vi.fn().mockResolvedValue(undefined),
    sendNotification: vi.fn().mockResolvedValue(undefined),
    loadWorkspaceConfig: vi.fn(),
    loadSpace: vi.fn(),
    llmChat: vi.fn().mockResolvedValue("mocked llm reply"),
  },
}));

import { pluginRegistry } from "@/engine/pluginRegistry";
import { createRunnerSession } from "@/contexts/runnerSession";
import type { NodePlugin } from "@/engine/plugin";
import type { ExecutionContext, NodeOutputEnvelope } from "@/engine/types";

const noopToast = () => {};

const TRIGGER_PLUGIN: NodePlugin = {
  type: "test-trigger",
  meta: {
    label: "Test Trigger",
    icon: "⚡",
    description: "",
    category: "input",
    color: "#fff",
  },
  defaultData: {},
  // No executor → passive node; engine default propagates upstream (or empty).
};

/**
 * Emits a fixed envelope value pulled from `node.data.fixedValue`. Stands in
 * for any upstream node that produces a known output without needing the
 * engine's passive fallback (which always emits `{ value: "" }` at a root).
 */
const SOURCE_PLUGIN: NodePlugin = {
  type: "test-source",
  meta: {
    label: "Test Source",
    icon: "🔌",
    description: "",
    category: "input",
    color: "#fff",
  },
  defaultData: {},
  executor: {
    async execute(ctx: ExecutionContext): Promise<void> {
      const value = String(ctx.node.data?.fixedValue ?? "");
      const envelope: NodeOutputEnvelope = { value };
      ctx.updateNodeData(ctx.node.id, {
        ...ctx.node.data,
        outputEnvelope: envelope,
      });
    },
  },
};

/**
 * Reads the first upstream node's `outputEnvelope.value` (filtered by
 * `visited`) and stores it on its own envelope. Mirrors `OutputExecutor` but
 * without the `data.upstreamEnvelope` field so the assertion shape is stable.
 */
const SINK_PLUGIN: NodePlugin = {
  type: "test-sink",
  meta: {
    label: "Test Sink",
    icon: "📤",
    description: "",
    category: "output",
    color: "#fff",
  },
  defaultData: {},
  executor: {
    async execute(ctx: ExecutionContext): Promise<void> {
      const incoming = ctx.edges.filter((e) => e.target === ctx.node.id);
      let value = "";
      for (const edge of incoming) {
        const upstream = ctx.nodes.find((n) => n.id === edge.source);
        if (!upstream) continue;
        if (ctx.visited && !ctx.visited.has(upstream.id)) continue;
        const upEnv = upstream.data?.outputEnvelope as
          | NodeOutputEnvelope
          | undefined;
        if (upEnv) {
          value = upEnv.value;
          break;
        }
      }
      ctx.updateNodeData(ctx.node.id, {
        ...ctx.node.data,
        outputEnvelope: { value },
      });
    },
  },
};

/** Source variant that throws on execute — used to assert error propagation. */
const FAILING_SOURCE_PLUGIN: NodePlugin = {
  type: "test-failing-source",
  meta: {
    label: "Failing Source",
    icon: "💥",
    description: "",
    category: "input",
    color: "#fff",
  },
  defaultData: {},
  executor: {
    async execute(_ctx: ExecutionContext): Promise<void> {
      throw new Error("boom");
    },
  },
};

function registerTestPlugins(): void {
  pluginRegistry.register(TRIGGER_PLUGIN);
  pluginRegistry.register(SOURCE_PLUGIN);
  pluginRegistry.register(SINK_PLUGIN);
  pluginRegistry.register(FAILING_SOURCE_PLUGIN);
}

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {}
): Node {
  return { id, type, position: { x: 0, y: 0 }, data };
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

describe("runWorkflow (in runnerSession)", () => {
  beforeEach(() => {
    registerTestPlugins();
  });

  it("propagates an envelope value end-to-end and marks every node success", async () => {
    const session = createRunnerSession({
      workspacePath: "/test/workspace",
      backgroundExecution: false,
    });
    session.attach(noopToast);
    session.setNodes([
      makeNode("trigger", "test-trigger"),
      makeNode("source", "test-source", { fixedValue: "hello world" }),
      makeNode("sink", "test-sink"),
    ]);
    session.setEdges([
      makeEdge("e1", "trigger", "source"),
      makeEdge("e2", "source", "sink"),
    ]);

    await session.executeWorkflow();

    const snap = session.getSnapshot();
    const trigger = snap.nodes.find((n) => n.id === "trigger");
    const source = snap.nodes.find((n) => n.id === "source");
    const sink = snap.nodes.find((n) => n.id === "sink");

    expect(trigger?.data?.status).toBe("success");
    expect(source?.data?.status).toBe("success");
    expect(sink?.data?.status).toBe("success");

    const sinkEnv = sink?.data?.outputEnvelope as NodeOutputEnvelope | undefined;
    expect(sinkEnv?.value).toBe("hello world");

    expect(session.hasActiveRuns()).toBe(false);
    expect(session.hasErrorNodes()).toBe(false);
  });

  it("marks a node 'error' and aborts the run when its executor throws", async () => {
    const session = createRunnerSession({
      workspacePath: "/test/workspace",
      backgroundExecution: false,
    });
    session.attach(noopToast);
    session.setNodes([
      makeNode("trigger", "test-trigger"),
      makeNode("boom", "test-failing-source"),
      makeNode("sink", "test-sink"),
    ]);
    session.setEdges([
      makeEdge("e1", "trigger", "boom"),
      makeEdge("e2", "boom", "sink"),
    ]);

    await session.executeWorkflow();

    const snap = session.getSnapshot();
    const boom = snap.nodes.find((n) => n.id === "boom");
    const sink = snap.nodes.find((n) => n.id === "sink");

    expect(boom?.data?.status).toBe("error");
    expect(boom?.data?.error).toBe("boom");
    // Sink should never have executed — left at its pre-execution "pending".
    expect(sink?.data?.status).toBe("pending");
    expect(session.hasErrorNodes()).toBe(true);
    expect(session.hasActiveRuns()).toBe(false);
  });

  it("cancelWorkflow stops an in-flight run and leaves no nodes in 'executing'", async () => {
    const session = createRunnerSession({
      workspacePath: "/test/workspace",
      backgroundExecution: false,
    });
    session.attach(noopToast);
    session.setNodes([
      makeNode("trigger", "test-trigger"),
      makeNode("source", "test-source", { fixedValue: "irrelevant" }),
      makeNode("sink", "test-sink"),
    ]);
    session.setEdges([
      makeEdge("e1", "trigger", "source"),
      makeEdge("e2", "source", "sink"),
    ]);

    const runPromise = session.executeWorkflow();
    // The run sleeps 600ms per node before executing. Cancel after a short
    // delay so we're inside the first node's pre-execute sleep.
    await new Promise((r) => setTimeout(r, 100));
    session.cancelWorkflow("trigger");
    await runPromise;

    const snap = session.getSnapshot();
    expect(session.hasActiveRuns()).toBe(false);
    for (const n of snap.nodes) {
      expect(n.data?.status).not.toBe("executing");
    }
  });
});
