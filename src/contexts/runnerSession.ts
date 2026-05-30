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
import { executeNode } from "@/engine";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { getAncestorNodeIds, getReachableNodeIds } from "@/engine/graphTraversal";
import { getConnectionBehavior } from "@/engine/connectivity";
import { EDGE } from "@/theme/colors";
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

interface RunControl {
  startKey: string;
  cancelled: boolean;
  inLoop: boolean;
  countReleased: boolean;
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
  /** Returns true if the session was disposed by this detach. */
  detach(): boolean;
  /** Flush any pending auto-save immediately (used by detach + close). */
  flushSave(): Promise<void>;
  dispose(): void;
  hasActiveRuns(): boolean;
  /** True if any currently-loaded node has `status: "error"`. */
  hasErrorNodes(): boolean;

  // ─── Runner ────────────────────────────────────────────────
  executeWorkflow(triggerNodeId?: string): Promise<void>;
  handleChatSend(nodeId: string, text: string): Promise<void>;
  retryWorkflow(nodeId: string): Promise<void>;
  cancelWorkflow(nodeId?: string): void;

  // ─── Space data loader (called by useWorkspaceSpaces) ──────
  loadSpaceData(spaceId: string): Promise<void>;
}

interface CreateSessionOptions {
  workspacePath: string;
  backgroundExecution: boolean;
  /** Called whenever `hasActiveRuns()` may have changed. */
  onActiveRunsChange?: () => void;
  /** Called when the session has disposed itself (post-run cleanup with no
   * editor attached and backgroundExecution off). The context uses this to
   * remove the entry from its sessions map. */
  onSelfDispose?: () => void;
}

export function createRunnerSession(opts: CreateSessionOptions): RunnerSession {
  const { workspacePath, onActiveRunsChange, onSelfDispose } = opts;

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
  const fadeTimeouts: Map<string, number> = new Map();
  const executedNodeIdsMap: Map<string, Set<string>> = new Map();
  const activeRuns: Map<string, RunControl> = new Map();
  let runCounter = 0;

  function hasActiveRuns(): boolean {
    return runningStartNodeIds.size > 0;
  }

  function hasErrorNodes(): boolean {
    return nodes.some((n) => n.data?.status === "error");
  }

  function notifyActiveRunsChange() {
    onActiveRunsChange?.();
  }

  // Track error-count transitions so the dashboard's red-dot listener fires
  // when an error first appears or is cleared. Reuses the same callback as
  // active-run transitions — the listener re-reads both via context getters.
  let hadErrors = false;
  function checkErrorTransition(): void {
    const has = hasErrorNodes();
    if (has !== hadErrors) {
      hadErrors = has;
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
    checkErrorTransition();
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
    checkErrorTransition();
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
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...data } } : n))
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

  function isCancelled(runId: string): boolean {
    return activeRuns.get(runId)?.cancelled === true;
  }

  function releaseRunCount(runId: string): void {
    const control = activeRuns.get(runId);
    if (!control || control.countReleased) return;
    control.countReleased = true;
    const key = control.startKey;
    updateRunningStartNodeIds((prev) => {
      const next = new Map(prev);
      const count = (next.get(key) ?? 0) - 1;
      if (count > 0) next.set(key, count);
      else next.delete(key);
      return next;
    });
  }

  function clearBordersForRuns(runIds: Set<string>): void {
    setNodes((nds) =>
      nds.map((n) => {
        const rid = n.data.statusRunId as string | undefined;
        if (rid && runIds.has(rid)) {
          return {
            ...n,
            data: { ...n.data, status: undefined, statusRunId: undefined, error: undefined },
          };
        }
        return n;
      })
    );
  }

  // ─── Run loop (moved from useWorkspaceRunner; reads session state) ─
  async function runWorkflow(startNodeIds: string[], chatInput?: string): Promise<void> {
    const startKey = startNodeIds.join(",");
    const runId = `${++runCounter}-${Date.now()}`;
    activeRuns.set(runId, {
      startKey,
      cancelled: false,
      inLoop: true,
      countReleased: false,
    });

    updateRunningStartNodeIds((prev) => {
      const next = new Map(prev);
      next.set(startKey, (next.get(startKey) ?? 0) + 1);
      return next;
    });

    if (!chatInput) {
      showToast("Workflow started", "info");
    }

    const isResuming = !!chatInput;
    console.log(
      "[RUNWORKFLOW] runId:",
      runId,
      "startNodeIds:",
      startNodeIds,
      "isResuming:",
      isResuming
    );

    const reachableDownstreamIds = getReachableNodeIds(startNodeIds, edges);
    const ancestorIds = getAncestorNodeIds(startNodeIds, edges);
    const startingStorageNodeIds = new Set<string>();
    startNodeIds.forEach((sid) => {
      const connectedEdges = edges.filter(
        (e) => e.source === sid && e.sourceHandle === "storage"
      );
      connectedEdges.forEach((e) => {
        startingStorageNodeIds.add(e.target);
      });
    });

    const hasTriggerStart = startNodeIds.some((sid) => {
      const n = nodes.find((node) => node.id === sid);
      return n?.type && !pluginRegistry.get(n.type)?.executor;
    });
    const isFreshRun = hasTriggerStart || !!chatInput;

    const inScope = (nodeId: string): boolean =>
      startNodeIds.includes(nodeId) ||
      startingStorageNodeIds.has(nodeId) ||
      reachableDownstreamIds.has(nodeId);

    const initStatusFor = (nodeId: string): string | undefined => {
      if (startNodeIds.includes(nodeId)) return undefined;
      if (startingStorageNodeIds.has(nodeId)) return "pending";
      if (reachableDownstreamIds.has(nodeId)) return "pending";
      return undefined;
    };

    const currentNodes = nodes.map((n) => {
      const newData = { ...n.data };
      if (isFreshRun) {
        delete newData.lastInputMessages;
        delete newData.lastInputText;
        delete newData.lastInputSender;
        delete newData.lastInputEnvelope;
      }
      if (!inScope(n.id)) {
        return { ...n, data: newData as Record<string, unknown> };
      }
      const newStatus = initStatusFor(n.id);
      return {
        ...n,
        data: {
          ...newData,
          status: newStatus,
          statusRunId: newStatus === undefined ? undefined : runId,
        } as Record<string, unknown>,
      };
    });

    const localUpdateNodeData = (nodeId: string, data: Record<string, unknown>): void => {
      const index = currentNodes.findIndex((n) => n.id === nodeId);
      if (index !== -1) {
        const oldNode = currentNodes[index];
        currentNodes[index] = { ...currentNodes[index], data: { ...data } };

        const nodePlugin = pluginRegistry.get(oldNode.type || "");
        if (nodePlugin?.canPauseWorkflow && data.status !== oldNode.data.status) {
          const storageEdge = edges.find(
            (e) => e.source === nodeId && e.sourceHandle === "storage"
          );
          const storageNode = storageEdge
            ? currentNodes.find(
                (n) => n.id === storageEdge.target && n.type === "jsonStorage"
              )
            : null;

          if (storageNode) {
            const newStorageStatus = data.status === "waiting" ? undefined : data.status;
            const newStorageRunId =
              newStorageStatus === undefined ? undefined : data.statusRunId;
            const storageIndex = currentNodes.findIndex((n) => n.id === storageNode.id);
            if (storageIndex !== -1) {
              currentNodes[storageIndex] = {
                ...currentNodes[storageIndex],
                data: {
                  ...currentNodes[storageIndex].data,
                  status: newStorageStatus,
                  statusRunId: newStorageRunId,
                },
              };
              updateNodeData(storageNode.id, currentNodes[storageIndex].data);
            }
          }
        }
      }
      updateNodeData(nodeId, data);
    };

    const applyStatus = (
      nodeId: string,
      baseData: Record<string, unknown>,
      status: string | undefined
    ): void => {
      localUpdateNodeData(nodeId, {
        ...baseData,
        status,
        statusRunId: status === undefined ? undefined : runId,
      });
    };

    let haltedAtChat = false;

    try {
      // Initialize statuses
      setNodes((nds) =>
        nds.map((n) => {
          const newData = { ...n.data };
          if (isFreshRun) {
            delete newData.lastInputMessages;
            delete newData.lastInputText;
            delete newData.lastInputSender;
            delete newData.lastInputEnvelope;
          }
          if (!inScope(n.id)) {
            return { ...n, data: newData };
          }
          const newStatus = initStatusFor(n.id);
          return {
            ...n,
            data: {
              ...newData,
              status: newStatus,
              statusRunId: newStatus === undefined ? undefined : runId,
            },
          };
        })
      );

      if (!executedNodeIdsMap.has(startKey)) {
        executedNodeIdsMap.set(startKey, new Set<string>());
      }
      const executedNodeIds = executedNodeIdsMap.get(startKey)!;

      if (hasTriggerStart) {
        executedNodeIds.clear();
      } else {
        reachableDownstreamIds.forEach((id) => {
          executedNodeIds.delete(id);
        });

        ancestorIds.forEach((ancId) => {
          const ancNode = currentNodes.find((n) => n.id === ancId);
          if (ancNode?.data?.status === "success") {
            executedNodeIds.add(ancId);
          }
        });
      }

      const visited = new Set<string>(executedNodeIds);
      startNodeIds.forEach((sid) => visited.delete(sid));
      const queue = [...startNodeIds];

      while (queue.length > 0) {
        if (isCancelled(runId)) break;

        const currentId = queue.shift()!;
        const isVisited = visited.has(currentId);
        const currentNode = currentNodes.find((n) => n.id === currentId);
        if (!currentNode) continue;

        if (isVisited) {
          const nodePlugin = pluginRegistry.get(currentNode.type || "");
          if (!nodePlugin?.canPauseWorkflow) {
            continue;
          }
        }
        visited.add(currentId);

        applyStatus(currentId, currentNode.data, "executing");
        const updatedNode = currentNodes.find((n) => n.id === currentId)!;

        await new Promise<void>((resolve) => setTimeout(resolve, 600));
        if (isCancelled(runId)) break;

        const postExecNodePlugin = pluginRegistry.get(updatedNode.type || "");
        const isStartingPauseNode =
          postExecNodePlugin?.canPauseWorkflow &&
          startNodeIds.includes(updatedNode.id) &&
          !isVisited;

        try {
          await executeNode(updatedNode.type || "default", {
            node: updatedNode,
            nodes: currentNodes,
            edges,
            updateNodeData: localUpdateNodeData,
            showToast,
            chatInput: isStartingPauseNode ? chatInput : undefined,
            visited,
            workspacePath,
          });

          if (isCancelled(runId)) break;

          const postExecNode = currentNodes.find((n) => n.id === currentId) || updatedNode;

          if (postExecNodePlugin?.canPauseWorkflow && !isStartingPauseNode) {
            const isReturnPath =
              isVisited ||
              ancestorIds.has(currentId) ||
              edges.some(
                (e) =>
                  e.source === currentId &&
                  e.data?.edgeType === "bi-directional" &&
                  executedNodeIds.has(e.target)
              );

            if (isReturnPath) {
              applyStatus(currentId, postExecNode.data, "success");
              executedNodeIds.add(currentId);
              continue;
            } else {
              applyStatus(currentId, postExecNode.data, "waiting");
              executedNodeIds.add(currentId);
              haltedAtChat = true;
              continue;
            }
          } else {
            const hasBiDirectionalEdge = edges.some(
              (e) =>
                (e.source === currentId && e.data?.edgeType === "bi-directional") ||
                (e.target === currentId && e.data?.edgeType === "bi-directional")
            );
            if (postExecNodePlugin?.canPauseWorkflow && hasBiDirectionalEdge) {
              applyStatus(currentId, postExecNode.data, "pending");
            } else {
              applyStatus(currentId, postExecNode.data, "success");
            }
            executedNodeIds.add(currentId);
          }
        } catch (err) {
          if (isCancelled(runId)) break;
          console.error(`[RUNWORKFLOW] Error executing node ${currentId}:`, err);
          const postExecNode = currentNodes.find((n) => n.id === currentId) || updatedNode;
          const errorMessage = err instanceof Error ? err.message : String(err);
          applyStatus(currentId, { ...postExecNode.data, error: errorMessage }, "error");
          throw err;
        }

        const downstreamTargets = edges
          .filter((e) => {
            if (e.sourceHandle === "storage" || e.targetHandle === "storage") return false;
            const srcNode = currentNodes.find((n) => n.id === e.source);
            const tgtNode = currentNodes.find((n) => n.id === e.target);
            const srcPlugin = pluginRegistry.get(srcNode?.type || "");
            const tgtPlugin = pluginRegistry.get(tgtNode?.type || "");
            if (
              srcPlugin?.meta.category === "storage" ||
              tgtPlugin?.meta.category === "storage"
            )
              return false;
            return (
              e.source === currentId ||
              (e.target === currentId && e.data?.edgeType === "bi-directional")
            );
          })
          .map((e) => (e.source === currentId ? e.target : e.source));

        queue.push(...downstreamTargets);
      }

      if (!isCancelled(runId)) {
        if (haltedAtChat) {
          showToast("Workflow paused at Chat. Awaiting message...", "info");
        } else {
          showToast("Workflow completed ✓", "success");
        }
      }
    } catch (err) {
      showToast(`Workflow failed: ${err}`, "error");
    } finally {
      const control = activeRuns.get(runId);
      if (control) control.inLoop = false;

      releaseRunCount(runId);

      if (isCancelled(runId)) {
        clearBordersForRuns(new Set([runId]));
        const t = fadeTimeouts.get(runId);
        if (t) {
          clearTimeout(t);
          fadeTimeouts.delete(runId);
        }
        activeRuns.delete(runId);
      } else {
        const timeoutId = window.setTimeout(() => {
          setNodes((nds) =>
            nds.map((n) => {
              if (n.data.statusRunId !== runId) return n;
              const s = n.data.status;
              if (s === "error" || s === "waiting") return n;
              if (s === "success" || s === "pending" || s === "executing") {
                return { ...n, data: { ...n.data, status: undefined, statusRunId: undefined } };
              }
              return n;
            })
          );
          fadeTimeouts.delete(runId);
          activeRuns.delete(runId);
        }, FADE_DELAY_MS);
        fadeTimeouts.set(runId, timeoutId);
      }
    }
  }

  function cancelWorkflow(nodeId?: string): void {
    if (activeRuns.size === 0) return;

    let targetRunIds: string[];
    if (nodeId) {
      const node = nodes.find((n) => n.id === nodeId);
      const rid = node?.data?.statusRunId as string | undefined;
      if (!rid || !activeRuns.has(rid)) return;
      targetRunIds = [rid];
    } else {
      targetRunIds = Array.from(activeRuns.keys());
    }

    const cancelledSet = new Set(targetRunIds);

    targetRunIds.forEach((rid) => {
      const r = activeRuns.get(rid);
      if (!r) return;
      r.cancelled = true;
      releaseRunCount(rid);
      const t = fadeTimeouts.get(rid);
      if (t) {
        clearTimeout(t);
        fadeTimeouts.delete(rid);
      }
      if (!r.inLoop) {
        activeRuns.delete(rid);
      }
    });

    clearBordersForRuns(cancelledSet);
    showToast("Workflow cancelled", "info");
  }

  async function executeWorkflow(triggerNodeId?: string): Promise<void> {
    let triggerNodes = nodes.filter((n) => {
      const plugin = pluginRegistry.get(n.type || "");
      return plugin && !plugin.executor;
    });
    if (triggerNodeId && typeof triggerNodeId === "string") {
      triggerNodes = triggerNodes.filter((n) => n.id === triggerNodeId);
    }
    if (triggerNodes.length === 0) {
      showToast("No Trigger node found", "error");
      return;
    }
    const startNodeIds = triggerNodes.map((n) => n.id);
    await runWorkflow(startNodeIds);
  }

  async function handleChatSend(nodeId: string, text: string): Promise<void> {
    const chatNode = nodes.find((n) => n.id === nodeId);
    if (!chatNode) return;
    await runWorkflow([nodeId], text);
  }

  async function retryWorkflow(nodeId: string): Promise<void> {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    showToast(`Retrying workflow from ${node.data?.label || node.type}...`, "info");
    await runWorkflow([nodeId]);
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

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.source_handle || undefined,
          targetHandle,
          type: "custom",
          data: { edgeType },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: EDGE.default,
            width: 16,
            height: 16,
          },
          markerStart:
            edgeType === "bi-directional"
              ? {
                  type: MarkerType.ArrowClosed,
                  color: EDGE.default,
                  width: 16,
                  height: 16,
                }
              : undefined,
          style: {
            stroke: EDGE.default,
            strokeWidth: 2,
          },
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
      // Surface any persisted error state to the dashboard's red-dot listener.
      checkErrorTransition();
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

    void flushSave().then(() => {
      dispose();
    });
    return true;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    for (const t of fadeTimeouts.values()) {
      clearTimeout(t);
    }
    fadeTimeouts.clear();
    activeRuns.clear();
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

    executeWorkflow,
    handleChatSend,
    retryWorkflow,
    cancelWorkflow,

    loadSpaceData,
  };

  return session;
}
