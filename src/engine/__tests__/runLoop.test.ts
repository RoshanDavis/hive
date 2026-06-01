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
import { getOutputEnvelope, setOutputEnvelope } from "@/engine/nodeData";

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
      ctx.updateNodeData(ctx.node.id, setOutputEnvelope(ctx.node.data, envelope));
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
        const upEnv = getOutputEnvelope(upstream.data);
        if (upEnv) {
          value = upEnv.value;
          break;
        }
      }
      ctx.updateNodeData(
        ctx.node.id,
        setOutputEnvelope(ctx.node.data, { value })
      );
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

    const sinkEnv = getOutputEnvelope(sink?.data);
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

  it("a workflow keeps running in its origin space when the user switches the active space", async () => {
    // Regression test: previously the session held a single nodes/edges
    // pair, so switching from space_1 to space_2 mid-run replaced the
    // canvas state with space_2's data and the in-flight run's writes
    // either silently missed or polluted space_2. After per-space slots,
    // the run continues to write into space_1's slot regardless of what
    // the user is viewing.
    const session = createRunnerSession({
      workspacePath: "/test/workspace",
      backgroundExecution: false,
    });
    session.attach(noopToast);

    // Populate space_1 (the run's origin space).
    session.setActiveSpaceId("space_1");
    session.setNodes([
      makeNode("trigger", "test-trigger"),
      makeNode("source", "test-source", { fixedValue: "from space_1" }),
      makeNode("sink", "test-sink"),
    ]);
    session.setEdges([
      makeEdge("e1", "trigger", "source"),
      makeEdge("e2", "source", "sink"),
    ]);

    // Start the workflow against space_1.
    const runPromise = session.executeWorkflow();

    // Switch to space_2 while the workflow is still inside its 600ms
    // pre-execute sleep on the first node. Populate space_2 with totally
    // different nodes that share NO ids with space_1 — if the run's
    // writes leak across, they'd land on these or be dropped.
    await new Promise((r) => setTimeout(r, 100));
    session.setActiveSpaceId("space_2");
    session.setNodes([
      makeNode("space2_trigger", "test-trigger"),
      makeNode("space2_sink", "test-sink"),
    ]);
    session.setEdges([makeEdge("se1", "space2_trigger", "space2_sink")]);

    // From space_2 the inspector should see no active runs (the
    // workflow lives in space_1) and no error/waiting nodes.
    const midSnap = session.getSnapshot();
    expect(midSnap.activeSpaceId).toBe("space_2");
    expect(midSnap.runningStartNodeIds.size).toBe(0);
    expect(midSnap.nodes.map((n) => n.id).sort()).toEqual([
      "space2_sink",
      "space2_trigger",
    ]);
    // But the session-wide active-run union still reports the run.
    expect(session.hasActiveRuns()).toBe(true);

    await runPromise;

    // Snapshot from space_2's view: still untouched by the run.
    const space2Snap = session.getSnapshot();
    expect(space2Snap.activeSpaceId).toBe("space_2");
    for (const n of space2Snap.nodes) {
      // None of space_2's nodes should have inherited any run status.
      expect(n.data?.status).toBeUndefined();
      expect(n.data?.statusRunId).toBeUndefined();
    }

    // Switch back to space_1 — the workflow's success status should be
    // visible on every node, and the envelope value should have
    // propagated end-to-end as if no space switch had happened.
    session.setActiveSpaceId("space_1");
    const space1Snap = session.getSnapshot();
    const trigger = space1Snap.nodes.find((n) => n.id === "trigger");
    const source = space1Snap.nodes.find((n) => n.id === "source");
    const sink = space1Snap.nodes.find((n) => n.id === "sink");
    expect(trigger?.data?.status).toBe("success");
    expect(source?.data?.status).toBe("success");
    expect(sink?.data?.status).toBe("success");
    expect(getOutputEnvelope(sink?.data)?.value).toBe("from space_1");

    expect(session.hasActiveRuns()).toBe(false);
    expect(session.hasErrorNodes()).toBe(false);
  });

  it("surfaces a sibling space's running workflow via otherSpaceWorkflows", async () => {
    // Spaces are organizational: a run in space_1 must stay visible from
    // space_2's inspector. The session exposes sibling-space activity via
    // `snapshot.otherSpaceWorkflows`, and `cancelWorkflowInSpace` controls
    // it without switching the active space.
    const session = createRunnerSession({
      workspacePath: "/test/workspace",
      backgroundExecution: true,
    });
    session.attach(noopToast);

    session.setActiveSpaceId("space_1");
    session.setSpaces([
      { id: "space_1", label: "1", order: 0 },
      { id: "space_2", label: "2", order: 1 },
    ]);
    session.setNodes([
      makeNode("trigger", "test-trigger"),
      makeNode("source", "test-source", { fixedValue: "x" }),
      makeNode("sink", "test-sink"),
    ]);
    session.setEdges([
      makeEdge("e1", "trigger", "source"),
      makeEdge("e2", "source", "sink"),
    ]);

    const runPromise = session.executeWorkflow();

    // Switch to space_2 while space_1's run is mid-flight.
    await new Promise((r) => setTimeout(r, 100));
    session.setActiveSpaceId("space_2");
    session.setNodes([makeNode("s2", "test-trigger")]);

    // From space_2's view: the active-space running list is empty, but the
    // sibling-space summary surfaces space_1's run.
    let snap = session.getSnapshot();
    expect(snap.activeSpaceId).toBe("space_2");
    expect(snap.runningStartNodeIds.size).toBe(0);
    expect(snap.otherSpaceWorkflows.length).toBe(1);
    expect(snap.otherSpaceWorkflows[0].spaceId).toBe("space_1");
    expect(snap.otherSpaceWorkflows[0].spaceLabel).toBe("1");
    expect(snap.otherSpaceWorkflows[0].activeRuns.length).toBe(1);
    expect(snap.otherSpaceWorkflows[0].activeRuns[0].startNodeIds).toEqual([
      "trigger",
    ]);

    await runPromise;

    // Once the run finishes, the sibling-space summary clears.
    snap = session.getSnapshot();
    expect(snap.otherSpaceWorkflows.length).toBe(0);
    expect(session.hasActiveRuns()).toBe(false);
  });

  it("cancelWorkflowInSpace stops a sibling space's run from another space", async () => {
    const session = createRunnerSession({
      workspacePath: "/test/workspace",
      backgroundExecution: true,
    });
    session.attach(noopToast);

    session.setActiveSpaceId("space_1");
    session.setSpaces([
      { id: "space_1", label: "1", order: 0 },
      { id: "space_2", label: "2", order: 1 },
    ]);
    session.setNodes([
      makeNode("trigger", "test-trigger"),
      makeNode("source", "test-source", { fixedValue: "x" }),
      makeNode("sink", "test-sink"),
    ]);
    session.setEdges([
      makeEdge("e1", "trigger", "source"),
      makeEdge("e2", "source", "sink"),
    ]);

    const runPromise = session.executeWorkflow();
    await new Promise((r) => setTimeout(r, 100));

    // View space_2, then cancel space_1's run from here.
    session.setActiveSpaceId("space_2");
    session.cancelWorkflowInSpace("space_1", "trigger");
    await runPromise;

    expect(session.hasActiveRuns()).toBe(false);
    const snap = session.getSnapshot();
    expect(snap.otherSpaceWorkflows.length).toBe(0);

    // space_1's nodes should be left with no in-flight status.
    session.setActiveSpaceId("space_1");
    for (const n of session.getSnapshot().nodes) {
      expect(n.data?.status).not.toBe("executing");
    }
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
