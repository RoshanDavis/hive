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
  type SpaceEntry,
  type SpaceData,
  type ShowToastFunc,
} from "@/types/workspace";

const FADE_DELAY_MS = 1500;
const AUTOSAVE_DEBOUNCE_MS = 800;
/** Cap the queued-toast buffer so a long-running background workspace can't
 * accumulate hundreds of stale toasts before the user re-opens it. */
const PENDING_TOAST_LIMIT = 20;

interface PendingToast {
  message: string;
  type: "success" | "error" | "info";
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface RunnerSessionSnapshot {
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
  spaces: SpaceEntry[];
  activeSpaceId: string;
  editingSpaceId: string | null;
  isLoading: boolean;
  runningStartNodeIds: Map<string, number>;
  backgroundExecution: boolean;
}

export interface RunnerSession {
  readonly workspacePath: string;

  // ─── State access ──────────────────────────────────────────
  getSnapshot(): RunnerSessionSnapshot;
  subscribe(listener: () => void): () => void;

  // ─── Canvas mutators ────────────────────────────────────────
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
  /** Flush any pending auto-save immediately (used by detach + close). */
  flushSave(): Promise<void>;
  dispose(): void;
  hasActiveRuns(): boolean;
  /** True if any currently-loaded node has `status: "error"`. */
  hasErrorNodes(): boolean;
  /** True if any currently-loaded node has `status: "waiting"` (chat pause). */
  hasWaitingNodes(): boolean;

  // ─── Runner ────────────────────────────────────────────────
  executeWorkflow(triggerNodeId?: string): Promise<void>;
  handleChatSend(nodeId: string, text: string): Promise<void>;
  retryWorkflow(nodeId: string): Promise<void>;
  cancelWorkflow(nodeId?: string): void;
  /** End every active workflow AND wipe `status`/`statusRunId`/`error` on
   * every node in the active space. Single atomic reset — runs are cancelled
   * first so their executors stop re-applying status, then the node sweep
   * removes both their borders and any stuck borders from earlier runs.
   * Surfaced as the "Clear all" button in the Workflows section. */
  clearAllStatuses(): void;

  // ─── Space data loader (called by useWorkspaceSpaces) ──────
  loadSpaceData(spaceId: string): Promise<void>;
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
  let nodes: Node[] = [];
  let edges: Edge[] = [];
  let viewport: Viewport = { x: 0, y: 0, zoom: 1 };
  let spaces: SpaceEntry[] = [];
  let activeSpaceId: string = "";
  let editingSpaceId: string | null = null;
  let isLoading: boolean = true;
  let runningStartNodeIds: Map<string, number> = new Map();
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

  function makeSnapshot(): RunnerSessionSnapshot {
    return {
      nodes,
      edges,
      viewport,
      spaces,
      activeSpaceId,
      editingSpaceId,
      isLoading,
      runningStartNodeIds,
      backgroundExecution,
    };
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
  // observes activity through the snapshot-visible `runningStartNodeIds`
  // map, which the loop bumps via `adjustRunningStartCount`.

  function hasActiveRuns(): boolean {
    return runningStartNodeIds.size > 0;
  }

  function hasErrorNodes(): boolean {
    return nodes.some((n) => n.data?.status === "error");
  }

  function hasWaitingNodes(): boolean {
    return nodes.some((n) => n.data?.status === "waiting");
  }

  function notifyActiveRunsChange() {
    onActiveRunsChange?.();
  }

  // Track error- and waiting-count transitions so the dashboard's red/yellow
  // dot listeners fire when state first appears or is cleared. Reuses the
  // active-runs callback — listeners re-read all three via context getters.
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

  // ─── Auto-save ────────────────────────────────────────────────────
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let isInitialLoad = true;

  function scheduleSave() {
    if (isInitialLoad || disposed) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveCurrentSpace();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function saveCurrentSpace(): Promise<void> {
    if (!activeSpaceId || isInitialLoad) return;
    const currentLabel = spaces.find((s) => s.id === activeSpaceId)?.label || activeSpaceId;
    const spaceData: SpaceData = {
      id: activeSpaceId,
      label: currentLabel,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type || "unknown",
        position: n.position,
        data: n.data as Record<string, unknown>,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        source_handle: e.sourceHandle || undefined,
        target_handle: e.targetHandle || undefined,
        edge_type: (e.data?.edgeType as string) || undefined,
      })),
      viewport,
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
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await saveCurrentSpace();
  }

  // ─── State mutators (notify + schedule save) ──────────────────────
  function setNodes(updater: Node[] | ((prev: Node[]) => Node[])): void {
    nodes = typeof updater === "function" ? (updater as (p: Node[]) => Node[])(nodes) : updater;
    notify();
    scheduleSave();
    checkStatusTransition();
  }

  function setEdges(updater: Edge[] | ((prev: Edge[]) => Edge[])): void {
    edges = typeof updater === "function" ? (updater as (p: Edge[]) => Edge[])(edges) : updater;
    notify();
    scheduleSave();
  }

  function applyNodeChangesInternal(changes: NodeChange[]): void {
    nodes = applyNodeChanges(changes, nodes);
    notify();
    scheduleSave();
    checkStatusTransition();
  }

  function applyEdgeChangesInternal(changes: EdgeChange[]): void {
    edges = applyEdgeChanges(changes, edges);
    notify();
    scheduleSave();
  }

  function setViewport(v: Viewport): void {
    viewport = v;
    // Viewport changes shouldn't bump the listener set (they don't affect
    // node/edge rendering) but they do dirty the persistence layer.
    scheduleSave();
  }

  function updateNodeData(nodeId: string, data: Record<string, unknown>): void {
    // Shallow-merge the incoming fields onto the LATEST live node.data so
    // partial updates (e.g. just `{ status, statusRunId }` from the run
    // loop) don't clobber concurrent user edits to unrelated fields. Callers
    // that still want to pass a full snapshot (executors, inspector edits)
    // continue to behave as before, since every field in the snapshot just
    // overlays onto whatever's current.
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      )
    );
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
  function updateRunningStartNodeIds(
    updater: (prev: Map<string, number>) => Map<string, number>
  ): void {
    const wasActive = runningStartNodeIds.size > 0;
    runningStartNodeIds = updater(runningStartNodeIds);
    notify();
    const isActive = runningStartNodeIds.size > 0;
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

  // The run loop is created below, after `setNodes` / `updateNodeData` / the
  // running-start-id delta callback are all defined. See the `runLoop` const.

  // ─── Run loop (now lives in src/engine/runLoop.ts) ────────────────
  // The session forwards execute/cancel/retry/clearAll into the loop. The
  // loop pushes deltas into `runningStartNodeIds` via the callback below, so
  // snapshot subscribers continue to see active-run transitions.
  const runLoop = createRunLoop({
    workspacePath,
    getNodes: () => nodes,
    getEdges: () => edges,
    setNodes,
    updateNodeData,
    showToast,
    adjustRunningStartCount: (startKey: string, delta: number) => {
      updateRunningStartNodeIds((prev) => {
        const next = new Map(prev);
        const count = (next.get(startKey) ?? 0) + delta;
        if (count > 0) next.set(startKey, count);
        else next.delete(startKey);
        return next;
      });
    },
  });

  async function executeWorkflow(triggerNodeId?: string): Promise<void> {
    await runLoop.executeWorkflow(triggerNodeId);
  }

  async function handleChatSend(nodeId: string, text: string): Promise<void> {
    await runLoop.handleChatSend(nodeId, text);
  }

  async function retryWorkflow(nodeId: string): Promise<void> {
    await runLoop.retryWorkflow(nodeId);
  }

  function cancelWorkflow(nodeId?: string): void {
    runLoop.cancelWorkflow(nodeId);
  }

  function clearAllStatuses(): void {
    runLoop.clearAllStatuses();
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
   * UI hooks don't need to know about the wire format. */
  async function loadSpaceData(spaceId: string): Promise<void> {
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

      // setNodes/setEdges here would schedule an auto-save during initial load;
      // we guard scheduleSave via isInitialLoad, but mutating + notifying is
      // still required so subscribers see the new arrays.
      nodes = loadedNodes;
      edges = loadedEdges;
      if (data.viewport.zoom > 0) {
        viewport = data.viewport;
      }
      notify();
      // Any `statusRunId` we just loaded points at a run from a previous
      // session — none of those are in the run loop's (empty) activeRuns
      // map, so they're all orphans. Drop the linkage but keep status/error
      // so the user still sees what happened (e.g. "Interrupted by app
      // exit" from the Rust-side force-kill sweep).
      runLoop.clearOrphanRunIds();
      // Surface any persisted error/waiting state to the dashboard's
      // red/yellow dot listeners.
      checkStatusTransition();
    } catch (err) {
      showToast(`Failed to load space: ${err}`, "error");
    }
  }

  // Expose loadSpaceData via the session so the spaces hook can call it.
  // (Added on the returned object below as `loadSpaceData`.)

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
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
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
    cancelWorkflow,
    clearAllStatuses,

    loadSpaceData,
  };

  return session;
}
