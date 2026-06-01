/**
 * RunnerSession — per-workspace canonical state + workflow runner. Lives in the
 * BackgroundRunnersContext map, not in any React component, so it can outlive
 * WorkspaceEditor mount/unmount. The editor attaches/detaches but never owns
 * the state; instead it reads via useSyncExternalStore.
 *
 * Created lazily on first `WorkspaceEditor` mount. By default a session disposes
 * itself on the last detach (matching today's behavior). Step 6 of the
 * background-execution feature flips this so a session with `backgroundExecution`
 * on and active runs is retained instead of disposed.
 *
 * State is keyed by `spaceId`, not flattened to a single canvas. The snapshot
 * exposes only the active space's slice so the editor view is unchanged, but
 * a workflow can keep running in space 1 while the user is viewing space 2 —
 * its writes route to space 1's slot via the run loop's space-aware deps,
 * and space 1's auto-save fires independently of which space is foregrounded.
 */

import {
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import { api } from "@/services/api";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { createRunLoop } from "@/engine/runLoop";
import { getConnectionBehavior } from "@/engine/connectivity";
import { getEdges } from "@/theme/colors";
import {
  buildWorkflowRows,
  type SpaceWorkflowSummary,
} from "@/engine/workflowRows";
import {
  type SpaceEntry,
  type SpaceData,
  type ShowToastFunc,
} from "@/types/workspace";

const FADE_DELAY_MS = 1500;
const AUTOSAVE_DEBOUNCE_MS = 800;
/** Cap the queued-toast buffer so a long-running background workspace can't
 * accumulate hundreds of stale toasts before the user re-opens it. */
const PENDING_TOAST_LIMIT = 20;

/** Default space-id used by tests that drive the session via `setNodes`/
 * `setEdges` before `init()` has chosen one. Mirrors the Rust default. */
const FALLBACK_SPACE_ID = "space_1";

interface PendingToast {
  message: string;
  type: "success" | "error" | "info";
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface SpaceState {
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
  /** Per-space debounced save timer. Each space dirties independently so a
   * write into space 1 (e.g. from a background run loop) flushes to its own
   * file even when the user is viewing space 2. */
  saveTimer: ReturnType<typeof setTimeout> | null;
  /** Has at least one mutation landed against this slot since `init`/load?
   * Guards `flushSave` from writing an empty buffer for a never-loaded space. */
  dirty: boolean;
}

export interface RunnerSessionSnapshot {
  /** Nodes for the active space only. Empty array if no space is active. */
  nodes: Node[];
  /** Edges for the active space only. */
  edges: Edge[];
  /** Viewport for the active space only. */
  viewport: Viewport;
  spaces: SpaceEntry[];
  activeSpaceId: string;
  editingSpaceId: string | null;
  isLoading: boolean;
  /** Running start-node-id counts for the active space only. */
  runningStartNodeIds: Map<string, number>;
  /** Workflow activity (running / waiting / errored) for every space OTHER
   * than the active one that currently has activity. Spaces are purely
   * organizational, so the Workflows inspector lists these alongside the
   * active space's own runs — a workflow started in space 1 stays visible
   * (and controllable) from space 2. Empty when no sibling space is busy. */
  otherSpaceWorkflows: SpaceWorkflowSummary[];
  backgroundExecution: boolean;
}

export interface RunnerSession {
  readonly workspacePath: string;

  // ─── State access ──────────────────────────────────────────
  getSnapshot(): RunnerSessionSnapshot;
  subscribe(listener: () => void): () => void;

  // ─── Canvas mutators (target the active space) ─────────────
  setNodes(updater: Node[] | ((prev: Node[]) => Node[])): void;
  setEdges(updater: Edge[] | ((prev: Edge[]) => Edge[])): void;
  applyNodeChanges(changes: NodeChange[]): void;
  applyEdgeChanges(changes: EdgeChange[]): void;
  setViewport(viewport: Viewport): void;
  updateNodeData(nodeId: string, data: Record<string, unknown>): void;

  // ─── Spaces mutators ───────────────────────────────────────
  setSpaces(updater: SpaceEntry[] | ((prev: SpaceEntry[]) => SpaceEntry[])): void;
  setActiveSpaceId(id: string): void;
  setEditingSpaceId(id: string | null): void;

  // ─── Settings ──────────────────────────────────────────────
  setBackgroundExecution(enabled: boolean): void;

  // ─── Toast routing ─────────────────────────────────────────
  /**
   * The editor sets this on attach to wire toast output to its own toast
   * container. Cleared on the last detach so toasts from a backgrounded
   * runner are silently dropped (Step 8 replaces with queue + OS notify).
   */
  setShowToast(fn: ShowToastFunc | null): void;

  // ─── Lifecycle ─────────────────────────────────────────────
  init(): Promise<void>;
  attach(showToast: ShowToastFunc): void;
  /** Decrement the mount ref-count and either retain (if backgrounded with
   * active runs) or schedule async flushSave+dispose. Always returns false:
   * when dispose IS scheduled, the session keeps itself registered until the
   * chain completes and calls `onSelfDispose`, so the context never needs to
   * branch on the return value. The boolean is preserved only to avoid a
   * silent API change for any out-of-tree caller. */
  detach(): boolean;
  /** Flush any pending auto-save immediately for every dirty space (used by
   * detach + close). */
  flushSave(): Promise<void>;
  dispose(): void;
  /** True if any run is active across *any* space. Dashboard-facing. */
  hasActiveRuns(): boolean;
  /** True if any currently-loaded node (across every loaded space) has
   * `status: "error"`. */
  hasErrorNodes(): boolean;
  /** True if any currently-loaded node (across every loaded space) has
   * `status: "waiting"` (chat pause). */
  hasWaitingNodes(): boolean;

  // ─── Runner ────────────────────────────────────────────────
  // The plain `executeWorkflow`/`retryWorkflow`/`cancelWorkflow` operate on
  // the active space. The `*InSpace` variants target an explicit space, used
  // by the Workflows inspector to control a sibling space's run without
  // forcing the user to switch to it first.
  executeWorkflow(triggerNodeId?: string): Promise<void>;
  handleChatSend(nodeId: string, text: string): Promise<void>;
  retryWorkflow(nodeId: string): Promise<void>;
  retryWorkflowInSpace(spaceId: string, nodeId: string): Promise<void>;
  cancelWorkflow(nodeId?: string): void;
  cancelWorkflowInSpace(spaceId: string, nodeId?: string): void;
  /** End every active workflow in the **active space** AND wipe
   * `status`/`statusRunId`/`error` on every node in that space. Workflows
   * running in other spaces (background) are not affected. */
  clearAllStatuses(): void;

  // ─── Space data loader (called by useWorkspaceSpaces) ──────
  /** Load a space's data from disk into the per-space cache. Idempotent: if
   * the space is already in memory (e.g. because a workflow is running in
   * it) the cached state is preserved and disk is NOT re-read. The optional
   * `force` flag overrides this for explicit refresh paths. */
  loadSpaceData(spaceId: string, opts?: { force?: boolean }): Promise<void>;
  /** Cancel any active runs in the given space, drop its in-memory slot,
   * and discard any pending save. Called by `handleDeleteSpace` after the
   * disk file has been removed. */
  removeSpaceState(spaceId: string): void;
}

interface CreateSessionOptions {
  workspacePath: string;
  backgroundExecution: boolean;
  /** Called whenever `hasActiveRuns()` may have changed. */
  onActiveRunsChange?: () => void;
  /** Called after each successful `save_space` so the provider can re-pull
   * the workspace's on-disk per-space rollup. Fires on every auto-save, not
   * only when status changed — it's a cheap RPC and the provider dedupes. */
  onAfterSave?: () => void;
  /** Called when the session has disposed itself (post-run cleanup with no
   * editor attached and backgroundExecution off). The context uses this to
   * remove the entry from its sessions map. */
  onSelfDispose?: () => void;
}

export function createRunnerSession(opts: CreateSessionOptions): RunnerSession {
  const { workspacePath, onActiveRunsChange, onAfterSave, onSelfDispose } = opts;

  // ─── Canonical state (held in plain closures, not React state) ─────
  // Per-space slots — switching the active space just flips the pointer, so
  // an in-flight workflow keeps writing into its own slot.
  const spaceStates: Map<string, SpaceState> = new Map();
  let spaces: SpaceEntry[] = [];
  let activeSpaceId: string = "";
  let editingSpaceId: string | null = null;
  let isLoading: boolean = true;
  // Per-space running start-node-id counts: `Map<spaceId, Map<startKey, count>>`.
  // The snapshot exposes only the active space's inner map; `hasActiveRuns()`
  // unions across every space for the dashboard.
  const runningStartNodeIdsBySpace: Map<string, Map<string, number>> = new Map();
  let backgroundExecution: boolean = opts.backgroundExecution;

  // Live toast sink (set by the editor on attach) and the queue used while
  // the editor is detached. On re-attach, the queue is drained into the new
  // sink so the user sees what happened while they were away.
  let liveShowToast: ShowToastFunc | null = null;
  const pendingToasts: PendingToast[] = [];

  function showToast(message: string, type: "success" | "error" | "info"): void {
    if (liveShowToast) {
      liveShowToast(message, type);
      return;
    }
    // Backgrounded: queue, and fire an OS notification for terminal errors
    // so the user knows something failed even if they never re-open the workspace.
    pendingToasts.push({ message, type });
    if (pendingToasts.length > PENDING_TOAST_LIMIT) {
      pendingToasts.splice(0, pendingToasts.length - PENDING_TOAST_LIMIT);
    }
    if (type === "error") {
      void api
        .sendNotification(`Hive workflow failed`, message)
        .catch(() => {
          // Notification permission may be denied; the queued toast still
          // surfaces on next attach, so this is non-fatal.
        });
    }
  }

  // Mount ref-counting so the session knows when nothing is observing it.
  let mountCount = 0;

  // ─── Subscriber bookkeeping ───────────────────────────────────────
  const listeners = new Set<() => void>();
  // Snapshot reference must change when state changes for useSyncExternalStore
  // to detect updates. We re-create it on every notify and cache between.
  let snapshot: RunnerSessionSnapshot = makeSnapshot();
  let disposed = false;

  // ─── Per-space state helpers ──────────────────────────────────────
  function getOrCreateSpaceState(spaceId: string): SpaceState {
    let s = spaceStates.get(spaceId);
    if (!s) {
      s = {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        saveTimer: null,
        dirty: false,
      };
      spaceStates.set(spaceId, s);
    }
    return s;
  }

  /** The "current" slot canvas mutators target. `init()` sets `activeSpaceId`
   * from disk; tests (and any caller that drives the session before `init`)
   * may write before any active space is chosen, so this lazily promotes the
   * fallback to be the active id. Production code never hits the empty
   * branch because `init()` always assigns first. */
  function resolveActiveSpaceId(): string {
    if (!activeSpaceId) activeSpaceId = FALLBACK_SPACE_ID;
    return activeSpaceId;
  }

  function getActiveState(): SpaceState {
    return getOrCreateSpaceState(resolveActiveSpaceId());
  }

  function makeSnapshot(): RunnerSessionSnapshot {
    // Use the raw active id (not resolveActiveSpaceId) so we don't
    // side-effect during a snapshot read. If a write has already happened
    // it will have promoted activeSpaceId to FALLBACK_SPACE_ID, so the
    // slot lookup still matches what setNodes wrote into.
    const id = activeSpaceId;
    const active = id ? spaceStates.get(id) : undefined;
    const runningForActive =
      (id && runningStartNodeIdsBySpace.get(id)) || new Map<string, number>();
    return {
      nodes: active?.nodes ?? [],
      edges: active?.edges ?? [],
      viewport: active?.viewport ?? { x: 0, y: 0, zoom: 1 },
      spaces,
      activeSpaceId,
      editingSpaceId,
      isLoading,
      runningStartNodeIds: runningForActive,
      otherSpaceWorkflows: buildOtherSpaceWorkflows(),
      backgroundExecution,
    };
  }

  /** Build the cross-space workflow summary for every space EXCEPT the active
   * one that currently has running/waiting/errored activity. Cheap — only
   * runs on `notify()`, and skips clean spaces entirely. */
  function buildOtherSpaceWorkflows(): SpaceWorkflowSummary[] {
    const out: SpaceWorkflowSummary[] = [];
    for (const [spaceId, st] of spaceStates) {
      if (spaceId === activeSpaceId) continue;
      const running =
        runningStartNodeIdsBySpace.get(spaceId) ?? new Map<string, number>();
      const rows = buildWorkflowRows(st.nodes, running);
      if (
        rows.activeRuns.length === 0 &&
        rows.waitingNodes.length === 0 &&
        rows.erroredNodes.length === 0
      ) {
        continue;
      }
      out.push({
        spaceId,
        spaceLabel: spaces.find((s) => s.id === spaceId)?.label || spaceId,
        activeRuns: rows.activeRuns,
        waitingNodes: rows.waitingNodes,
        erroredNodes: rows.erroredNodes,
      });
    }
    // Stable order by the space's configured order so the list doesn't
    // jump around as background runs come and go.
    out.sort((a, b) => {
      const ao = spaces.find((s) => s.id === a.spaceId)?.order ?? 0;
      const bo = spaces.find((s) => s.id === b.spaceId)?.order ?? 0;
      return ao - bo;
    });
    return out;
  }

  function notify() {
    snapshot = makeSnapshot();
    for (const listener of listeners) {
      listener();
    }
  }

  // ─── Run-state bookkeeping ─────────────────────────────────────────
  // The run loop itself (BFS traversal, status transitions, retry/cancel
  // controls, fade timers) lives in `src/engine/runLoop.ts`. The session
  // observes activity through the per-space `runningStartNodeIdsBySpace`
  // map, which the loop bumps via `adjustRunningStartCount`.

  function hasActiveRuns(): boolean {
    for (const map of runningStartNodeIdsBySpace.values()) {
      if (map.size > 0) return true;
    }
    return false;
  }

  function hasErrorNodes(): boolean {
    for (const s of spaceStates.values()) {
      if (s.nodes.some((n) => n.data?.status === "error")) return true;
    }
    return false;
  }

  function hasWaitingNodes(): boolean {
    for (const s of spaceStates.values()) {
      if (s.nodes.some((n) => n.data?.status === "waiting")) return true;
    }
    return false;
  }

  function notifyActiveRunsChange() {
    onActiveRunsChange?.();
  }

  // Track error- and waiting-presence transitions so the dashboard's
  // red/yellow dot listeners fire when state first appears or is cleared.
  // Reuses the active-runs callback — listeners re-read all three via
  // context getters.
  let hadErrors = false;
  let hadWaiting = false;
  function checkStatusTransition(): void {
    const errs = hasErrorNodes();
    const waits = hasWaitingNodes();
    if (errs !== hadErrors || waits !== hadWaiting) {
      hadErrors = errs;
      hadWaiting = waits;
      notifyActiveRunsChange();
    }
  }

  // ─── Auto-save (per-space) ────────────────────────────────────────
  // Initial-load gate: until `init()` resolves, every load/edit is silent.
  // Each space's first scheduled save flips its `dirty` bit; on dispose we
  // flush every dirty space.
  let isInitialLoad = true;

  function scheduleSaveForSpace(spaceId: string) {
    if (isInitialLoad || disposed) return;
    const s = getOrCreateSpaceState(spaceId);
    s.dirty = true;
    if (s.saveTimer) clearTimeout(s.saveTimer);
    s.saveTimer = setTimeout(() => {
      s.saveTimer = null;
      void saveSpace(spaceId);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function saveSpace(spaceId: string): Promise<void> {
    if (!spaceId || isInitialLoad) return;
    const state = spaceStates.get(spaceId);
    if (!state) return;
    const label = spaces.find((s) => s.id === spaceId)?.label || spaceId;
    const spaceData: SpaceData = {
      id: spaceId,
      label,
      nodes: state.nodes.map((n) => ({
        id: n.id,
        type: n.type || "unknown",
        position: n.position,
        data: n.data as Record<string, unknown>,
      })),
      edges: state.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        source_handle: e.sourceHandle || undefined,
        target_handle: e.targetHandle || undefined,
        edge_type: (e.data?.edgeType as string) || undefined,
      })),
      viewport: state.viewport,
    };
    try {
      await api.saveSpace(workspacePath, spaceData);
      // Save just updated the per-space rollup on disk. Let the provider
      // re-pull it so cross-space Dashboard dots stay current. Failing
      // silently is fine — the next save will retry.
      onAfterSave?.();
    } catch (err) {
      console.error("Auto-save failed:", err);
    }
  }

  async function flushSave(): Promise<void> {
    const toFlush: string[] = [];
    for (const [spaceId, s] of spaceStates) {
      if (s.saveTimer) {
        clearTimeout(s.saveTimer);
        s.saveTimer = null;
      }
      if (s.dirty) toFlush.push(spaceId);
    }
    await Promise.all(toFlush.map((id) => saveSpace(id)));
  }

  // ─── State mutators (notify + schedule save) ──────────────────────
  function setNodesForSpace(
    spaceId: string,
    updater: Node[] | ((prev: Node[]) => Node[])
  ): void {
    const s = getOrCreateSpaceState(spaceId);
    s.nodes =
      typeof updater === "function" ? (updater as (p: Node[]) => Node[])(s.nodes) : updater;
    // Always notify — even for a background space. A run loop ticking in a
    // non-active space changes its node statuses, and the Workflows inspector
    // surfaces those (waiting/errored rows) for every space. The active
    // space's node/edge array refs are unchanged by a background write, so
    // ReactFlow itself bails out of re-rendering; only the lightweight
    // inspector tree re-derives from the new snapshot.
    notify();
    scheduleSaveForSpace(spaceId);
    checkStatusTransition();
  }

  function setEdgesForSpace(
    spaceId: string,
    updater: Edge[] | ((prev: Edge[]) => Edge[])
  ): void {
    const s = getOrCreateSpaceState(spaceId);
    s.edges =
      typeof updater === "function" ? (updater as (p: Edge[]) => Edge[])(s.edges) : updater;
    notify();
    scheduleSaveForSpace(spaceId);
  }

  function updateNodeDataForSpace(
    spaceId: string,
    nodeId: string,
    data: Record<string, unknown>
  ): void {
    setNodesForSpace(spaceId, (nds) =>
      nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      )
    );
  }

  function setNodes(updater: Node[] | ((prev: Node[]) => Node[])): void {
    setNodesForSpace(resolveActiveSpaceId(), updater);
  }

  function setEdges(updater: Edge[] | ((prev: Edge[]) => Edge[])): void {
    setEdgesForSpace(resolveActiveSpaceId(), updater);
  }

  function applyNodeChangesInternal(changes: NodeChange[]): void {
    const s = getActiveState();
    s.nodes = applyNodeChanges(changes, s.nodes);
    notify();
    scheduleSaveForSpace(resolveActiveSpaceId());
    checkStatusTransition();
  }

  function applyEdgeChangesInternal(changes: EdgeChange[]): void {
    const s = getActiveState();
    s.edges = applyEdgeChanges(changes, s.edges);
    notify();
    scheduleSaveForSpace(resolveActiveSpaceId());
  }

  function setViewport(v: Viewport): void {
    const s = getActiveState();
    s.viewport = v;
    // Viewport changes shouldn't bump the listener set (they don't affect
    // node/edge rendering) but they do dirty the persistence layer.
    scheduleSaveForSpace(resolveActiveSpaceId());
  }

  function updateNodeData(nodeId: string, data: Record<string, unknown>): void {
    // Shallow-merge the incoming fields onto the LATEST live node.data so
    // partial updates (e.g. just `{ status, statusRunId }` from the run
    // loop) don't clobber concurrent user edits to unrelated fields.
    updateNodeDataForSpace(resolveActiveSpaceId(), nodeId, data);
  }

  function setSpaces(updater: SpaceEntry[] | ((prev: SpaceEntry[]) => SpaceEntry[])): void {
    spaces = typeof updater === "function" ? (updater as (p: SpaceEntry[]) => SpaceEntry[])(spaces) : updater;
    notify();
  }

  function setActiveSpaceId(id: string): void {
    activeSpaceId = id;
    notify();
  }

  function setEditingSpaceId(id: string | null): void {
    editingSpaceId = id;
    notify();
  }

  function setBackgroundExecution(enabled: boolean): void {
    backgroundExecution = enabled;
    notify();
  }

  function setIsLoading(v: boolean) {
    isLoading = v;
    notify();
  }

  // ─── Run state ────────────────────────────────────────────────────
  function adjustRunningStartCount(
    spaceId: string,
    startKey: string,
    delta: number
  ): void {
    const wasActive = hasActiveRuns();
    let inner = runningStartNodeIdsBySpace.get(spaceId);
    if (!inner) {
      inner = new Map<string, number>();
      runningStartNodeIdsBySpace.set(spaceId, inner);
    }
    // Replace the inner map with a fresh instance so consumers using `===`
    // identity (e.g. memoized selectors) see a change.
    const next = new Map(inner);
    const count = (next.get(startKey) ?? 0) + delta;
    if (count > 0) next.set(startKey, count);
    else next.delete(startKey);
    if (next.size === 0) {
      runningStartNodeIdsBySpace.delete(spaceId);
    } else {
      runningStartNodeIdsBySpace.set(spaceId, next);
    }
    // Always notify so a run starting/ending in a background space updates
    // the Workflows inspector's cross-space "Running" list, not just the
    // active space's view.
    notify();
    const isActive = hasActiveRuns();
    if (wasActive !== isActive) {
      notifyActiveRunsChange();
      // Post-run cleanup: if runs just hit zero AND no editor is attached AND
      // the user has disabled background execution, dispose now. This is the
      // hook the BackgroundRunnersContext relies on for "toggle off mid-run
      // → tear down once run finishes" cleanup.
      if (!isActive && mountCount === 0 && !backgroundExecution) {
        // Defer so the run's own `finally` (which writes the fade timer) has
        // a chance to finish before we tear it all down.
        setTimeout(() => {
          if (mountCount === 0 && !hasActiveRuns()) {
            void flushSave().then(() => {
              dispose();
              onSelfDispose?.();
            });
          }
        }, FADE_DELAY_MS + 50);
      }
    }
  }

  // ─── Run loop (lives in src/engine/runLoop.ts) ────────────────────
  // The loop is now space-aware: every public method takes a `spaceId` so
  // an in-flight run's writes route to the right slot even when the user
  // has switched the foreground space.
  const runLoop = createRunLoop({
    workspacePath,
    getNodes: (spaceId: string) => getOrCreateSpaceState(spaceId).nodes,
    getEdges: (spaceId: string) => getOrCreateSpaceState(spaceId).edges,
    setNodes: setNodesForSpace,
    updateNodeData: updateNodeDataForSpace,
    showToast,
    adjustRunningStartCount,
  });

  /** Capture the active spaceId at call-time, before any await, so a fast
   * space switch by the user can't redirect this run to a different slot. */
  async function executeWorkflow(triggerNodeId?: string): Promise<void> {
    const spaceId = resolveActiveSpaceId();
    await runLoop.executeWorkflow(spaceId, triggerNodeId);
  }

  async function handleChatSend(nodeId: string, text: string): Promise<void> {
    const spaceId = resolveActiveSpaceId();
    await runLoop.handleChatSend(spaceId, nodeId, text);
  }

  async function retryWorkflow(nodeId: string): Promise<void> {
    const spaceId = resolveActiveSpaceId();
    await runLoop.retryWorkflow(spaceId, nodeId);
  }

  async function retryWorkflowInSpace(spaceId: string, nodeId: string): Promise<void> {
    await runLoop.retryWorkflow(spaceId, nodeId);
  }

  function cancelWorkflow(nodeId?: string): void {
    const spaceId = resolveActiveSpaceId();
    runLoop.cancelWorkflow(spaceId, nodeId);
  }

  function cancelWorkflowInSpace(spaceId: string, nodeId?: string): void {
    runLoop.cancelWorkflow(spaceId, nodeId);
  }

  function clearAllStatuses(): void {
    const spaceId = resolveActiveSpaceId();
    runLoop.clearAllStatuses(spaceId);
  }

  // ─── Initial load (called once by the context when session is first created) ─
  async function init(): Promise<void> {
    setIsLoading(true);
    try {
      const config = await api.loadWorkspaceConfig(workspacePath);
      setSpaces(config.spaces);
      const spaceToLoad = config.active_space || config.spaces[0]?.id || "space_1";
      setActiveSpaceId(spaceToLoad);
      await loadSpaceData(spaceToLoad);
    } catch (err) {
      showToast(`Failed to load workspace: ${err}`, "error");
    } finally {
      setIsLoading(false);
      // Allow auto-save once the initial load settles.
      setTimeout(() => {
        isInitialLoad = false;
      }, 500);
    }
  }

  /** Public helper used by space-switch flows. Exposed via the session so the
   * UI hooks don't need to know about the wire format. Idempotent on the
   * in-memory cache: if the slot already exists (e.g. because a workflow
   * has been running in it while the user was viewing another space), the
   * cached state is preserved and disk is NOT re-read. */
  async function loadSpaceData(
    spaceId: string,
    opts: { force?: boolean } = {}
  ): Promise<void> {
    const existing = spaceStates.get(spaceId);
    if (existing && !opts.force) {
      // Already in memory — re-publish a snapshot so the active-view swap
      // shows whatever state the run loop has accumulated, then surface
      // any persisted error/waiting state to the dashboard listeners.
      if (spaceId === activeSpaceId) notify();
      runLoop.clearOrphanRunIds(spaceId);
      checkStatusTransition();
      return;
    }
    try {
      const data = await api.loadSpace(workspacePath, spaceId);

      const loadedNodes: Node[] = data.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
      }));

      const edgeColor = getEdges().default;
      const loadedEdges: Edge[] = data.edges.map((e) => {
        const targetNode = data.nodes.find((n) => n.id === e.target);
        const targetPlugin = targetNode
          ? pluginRegistry.get(targetNode.type)
          : undefined;
        const targetHandle =
          targetPlugin?.meta.category === "storage" && !e.target_handle
            ? "left"
            : e.target_handle || undefined;

        const sourceNode = data.nodes.find((n) => n.id === e.source);
        const { allowedOption } = getConnectionBehavior(
          sourceNode?.type,
          targetNode?.type,
          e.source_handle || undefined,
          targetHandle
        );

        let edgeType = e.edge_type || "one-way";
        if (edgeType === "bi-directional" && allowedOption === "one-way") {
          edgeType = "one-way";
        }

        const marker = {
          type: MarkerType.ArrowClosed,
          color: edgeColor,
          width: 16,
          height: 16,
        };

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.source_handle || undefined,
          targetHandle,
          type: "custom",
          data: { edgeType },
          markerEnd: marker,
          markerStart: edgeType === "bi-directional" ? marker : undefined,
          style: { stroke: edgeColor, strokeWidth: 2 },
        };
      });

      const slot = getOrCreateSpaceState(spaceId);
      slot.nodes = loadedNodes;
      slot.edges = loadedEdges;
      if (data.viewport.zoom > 0) {
        slot.viewport = data.viewport;
      }
      // Force-reload (opts.force) re-sets the dirty flag so a follow-up
      // flushSave still writes; the no-force initial load leaves it false
      // because we just hydrated from disk.
      if (opts.force) slot.dirty = true;

      if (spaceId === activeSpaceId) notify();
      // Any `statusRunId` we just loaded points at a run from a previous
      // session — none of those are in the run loop's (empty) activeRuns
      // map, so they're all orphans. Drop the linkage but keep status/error
      // so the user still sees what happened (e.g. "Interrupted by app
      // exit" from the Rust-side force-kill sweep).
      runLoop.clearOrphanRunIds(spaceId);
      // Surface any persisted error/waiting state to the dashboard's
      // red/yellow dot listeners.
      checkStatusTransition();
    } catch (err) {
      showToast(`Failed to load space: ${err}`, "error");
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────
  function attach(setToast: ShowToastFunc): void {
    mountCount += 1;
    liveShowToast = setToast;
    drainPendingToasts();
  }

  function drainPendingToasts(): void {
    if (!liveShowToast || pendingToasts.length === 0) return;
    const sink = liveShowToast;
    const drained = pendingToasts.splice(0);
    // Defer so the toast container has finished re-mounting before we push.
    setTimeout(() => {
      for (const t of drained) sink(t.message, t.type);
    }, 0);
  }

  function detach(): boolean {
    mountCount = Math.max(0, mountCount - 1);
    if (mountCount > 0) return false;

    const shouldRetain = backgroundExecution && hasActiveRuns();
    if (shouldRetain) {
      // Backgrounded: toasts queue + OS-notify on errors (handled in showToast).
      liveShowToast = null;
      return false;
    }

    // Defer context removal until the async flushSave+dispose chain actually
    // completes. If we returned `true` here the context would drop us from
    // its sessions map immediately, and a quick re-mount would create a
    // duplicate session running in parallel with our in-flight save. The
    // post-run cleanup path uses the same onSelfDispose-based removal, so
    // there's one removal mechanism instead of two.
    void flushSave().then(() => {
      dispose();
      onSelfDispose?.();
    });
    return false;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const s of spaceStates.values()) {
      if (s.saveTimer) {
        clearTimeout(s.saveTimer);
        s.saveTimer = null;
      }
    }
    runLoop.dispose();
    listeners.clear();
    liveShowToast = null;
    pendingToasts.length = 0;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function setShowToast(fn: ShowToastFunc | null): void {
    liveShowToast = fn;
    if (fn) drainPendingToasts();
  }

  function removeSpaceState(spaceId: string): void {
    // Cancel anything running in the doomed space first — we don't want a
    // run loop continuing to write into a slot we're about to drop, or
    // (worse) re-create the slot via getOrCreateSpaceState on its next write.
    runLoop.cancelWorkflow(spaceId);
    const s = spaceStates.get(spaceId);
    if (s?.saveTimer) {
      clearTimeout(s.saveTimer);
      s.saveTimer = null;
    }
    spaceStates.delete(spaceId);
    runningStartNodeIdsBySpace.delete(spaceId);
    if (spaceId === activeSpaceId) notify();
    checkStatusTransition();
  }

  // ─── Public session object ────────────────────────────────────────
  const session: RunnerSession = {
    workspacePath,
    getSnapshot: () => snapshot,
    subscribe,

    setNodes,
    setEdges,
    applyNodeChanges: applyNodeChangesInternal,
    applyEdgeChanges: applyEdgeChangesInternal,
    setViewport,
    updateNodeData,

    setSpaces,
    setActiveSpaceId,
    setEditingSpaceId,

    setBackgroundExecution,
    setShowToast,

    init,
    attach,
    detach,
    flushSave,
    dispose,
    hasActiveRuns,
    hasErrorNodes,
    hasWaitingNodes,

    executeWorkflow,
    handleChatSend,
    retryWorkflow,
    retryWorkflowInSpace,
    cancelWorkflow,
    cancelWorkflowInSpace,
    clearAllStatuses,

    loadSpaceData,
    removeSpaceState,
  };

  return session;
}
