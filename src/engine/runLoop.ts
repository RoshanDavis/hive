/**
 * Workflow run loop. Extracted from `RunnerSession` so the BFS traversal,
 * status state machine, retry/cancel controls, and fade-timer bookkeeping can
 * be reasoned about (and tested) in isolation from session lifecycle, canvas
 * state, and persistence.
 *
 * The loop owns its own internal state — `activeRuns`, `executedNodeIdsMap`,
 * `runCounter`, `fadeTimeouts` — and reads/writes session-visible state via
 * the {@link RunLoopDeps} callbacks. The session owns the per-space
 * `runningStartNodeIdsBySpace` map and bumps it via `adjustRunningStartCount`,
 * so subscribers see active-run transitions through the existing snapshot path.
 *
 * Every public method (and every dep callback) takes a `spaceId`: the loop is
 * space-aware so a workflow can keep running in space 1 while the user has
 * switched the foreground to space 2. The spaceId is captured into the
 * `RunControl` at run start; every read/write inside `runWorkflow` routes
 * through it, never through "whatever space is active right now".
 *
 * See {@link RunLoop} for the public surface and `runnerSession.ts` for the
 * wiring.
 */

import type { Node, Edge } from "@xyflow/react";
import { executeNode } from "./index";
import { pluginRegistry } from "./pluginRegistry";
import {
  getAncestorNodeIds,
  getConnectedComponent,
  getReachableNodeIds,
} from "./graphTraversal";
import { LAST_INPUT_KEYS } from "./nodeData";

/** How long a completed run's success/pending borders linger before fading. */
const FADE_DELAY_MS = 1500;

interface RunControl {
  /** Which space this run belongs to — set at run start, never changes. All
   * reads/writes from this run are scoped to this id even if the user
   * switches the foreground to a different space. */
  spaceId: string;
  startKey: string;
  cancelled: boolean;
  /** True while the BFS loop is still iterating; flipped false in `finally`. */
  inLoop: boolean;
  /** True once this run's contribution to the running-start-id count has been
   * decremented. Guards against double-release on the cancel-then-finally
   * path. */
  countReleased: boolean;
}

export interface RunLoopDeps {
  workspacePath: string;
  getNodes(spaceId: string): Node[];
  getEdges(spaceId: string): Edge[];
  setNodes(
    spaceId: string,
    updater: Node[] | ((prev: Node[]) => Node[])
  ): void;
  updateNodeData(
    spaceId: string,
    nodeId: string,
    data: Record<string, unknown>
  ): void;
  showToast(msg: string, type: "success" | "error" | "info"): void;
  /** Push a delta (positive on run start, negative on run release) to the
   * per-space `runningStartNodeIdsBySpace` map held by the session. */
  adjustRunningStartCount(
    spaceId: string,
    startKey: string,
    delta: number
  ): void;
}

export interface RunLoop {
  executeWorkflow(spaceId: string, triggerNodeId?: string): Promise<void>;
  handleChatSend(spaceId: string, nodeId: string, text: string): Promise<void>;
  retryWorkflow(spaceId: string, nodeId: string): Promise<void>;
  /** Cancel one workflow scoped to a node's connected component within
   * `spaceId`, or every active run in `spaceId` if `nodeId` is omitted. Runs
   * in other spaces are untouched. */
  cancelWorkflow(spaceId: string, nodeId?: string): void;
  /** End every active run in `spaceId` AND wipe status/statusRunId/error on
   * every node in that space. Runs in other spaces are untouched. */
  clearAllStatuses(spaceId: string): void;
  /** True if any run is still in its BFS loop in *any* space (excludes runs
   * in fade window). Dashboard-facing union. */
  hasActiveRuns(): boolean;
  /** Drop linkage on any persisted statusRunId that no longer references a
   * live run, scoped to one space. Preserves status/error so the user still
   * sees what happened. Called after `loadSpaceData`. */
  clearOrphanRunIds(spaceId: string): void;
  /** Shut down internal timers/state. Called when the session disposes. */
  dispose(): void;
}

export function createRunLoop(deps: RunLoopDeps): RunLoop {
  const { workspacePath, getNodes, getEdges, setNodes, updateNodeData, showToast } = deps;

  const activeRuns: Map<string, RunControl> = new Map();
  /** Keyed by `${spaceId}::${startKey}` so retry-cache reuse is scoped to the
   * run's space — a `chat-1` startKey in space 1 won't collide with the same
   * id in space 2 if a user duplicates a layout. */
  const executedNodeIdsMap: Map<string, Set<string>> = new Map();
  const fadeTimeouts: Map<string, number> = new Map();
  let runCounter = 0;

  function executedKey(spaceId: string, startKey: string): string {
    return `${spaceId}::${startKey}`;
  }

  function hasActiveRuns(): boolean {
    for (const r of activeRuns.values()) {
      if (r.inLoop) return true;
    }
    return false;
  }

  function isCancelled(runId: string): boolean {
    return activeRuns.get(runId)?.cancelled === true;
  }

  function releaseRunCount(runId: string): void {
    const control = activeRuns.get(runId);
    if (!control || control.countReleased) return;
    control.countReleased = true;
    deps.adjustRunningStartCount(control.spaceId, control.startKey, -1);
  }

  function clearBordersForRuns(spaceId: string, runIds: Set<string>): void {
    setNodes(spaceId, (nds) =>
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

  function clearOrphanRunIds(spaceId: string): void {
    setNodes(spaceId, (nds) =>
      nds.map((n) => {
        const rid = n.data.statusRunId as string | undefined;
        if (rid && !activeRuns.has(rid)) {
          return { ...n, data: { ...n.data, statusRunId: undefined } };
        }
        return n;
      })
    );
  }

  /** Aggressive sweep used by Retry: clear `status`/`statusRunId`/`error`
   * on every node in `spaceId` NOT currently part of an active run. Nodes
   * still tied to an in-flight workflow (e.g. a concurrent run) are left
   * alone. */
  function clearOrphanStatusesAggressive(spaceId: string): void {
    setNodes(spaceId, (nds) =>
      nds.map((n) => {
        const rid = n.data.statusRunId as string | undefined;
        if (rid && activeRuns.has(rid)) return n;
        if (!n.data.status && !n.data.statusRunId && !n.data.error) return n;
        return {
          ...n,
          data: { ...n.data, status: undefined, statusRunId: undefined, error: undefined },
        };
      })
    );
  }

  function clearAllStatuses(spaceId: string): void {
    // Cancel only runs that belong to this space. Runs in other spaces
    // (e.g. a background workflow the user navigated away from) continue.
    const runIdsInSpace: string[] = [];
    for (const [rid, control] of activeRuns) {
      if (control.spaceId !== spaceId) continue;
      runIdsInSpace.push(rid);
      control.cancelled = true;
      releaseRunCount(rid);
      const t = fadeTimeouts.get(rid);
      if (t) {
        clearTimeout(t);
        fadeTimeouts.delete(rid);
      }
      if (!control.inLoop) activeRuns.delete(rid);
    }

    let touched = 0;
    setNodes(spaceId, (nds) =>
      nds.map((n) => {
        if (!n.data.status && !n.data.statusRunId && !n.data.error) return n;
        touched += 1;
        return {
          ...n,
          data: { ...n.data, status: undefined, statusRunId: undefined, error: undefined },
        };
      })
    );

    if (runIdsInSpace.length > 0 && touched > 0) {
      showToast(
        `Cancelled ${runIdsInSpace.length} workflow${runIdsInSpace.length === 1 ? "" : "s"} and cleared ${touched} node${touched === 1 ? "" : "s"}`,
        "info"
      );
    } else if (runIdsInSpace.length > 0) {
      showToast(
        `Cancelled ${runIdsInSpace.length} workflow${runIdsInSpace.length === 1 ? "" : "s"}`,
        "info"
      );
    } else if (touched > 0) {
      showToast(`Cleared status on ${touched} node${touched === 1 ? "" : "s"}`, "info");
    }
  }

  async function runWorkflow(
    spaceId: string,
    startNodeIds: string[],
    chatInput?: string
  ): Promise<void> {
    const nodes = getNodes(spaceId);
    const edges = getEdges(spaceId);
    const startKey = startNodeIds.join(",");
    const runId = `${++runCounter}-${Date.now()}`;
    activeRuns.set(runId, {
      spaceId,
      startKey,
      cancelled: false,
      inLoop: true,
      countReleased: false,
    });

    deps.adjustRunningStartCount(spaceId, startKey, 1);

    if (!chatInput) {
      showToast("Workflow started", "info");
    }

    const isResuming = !!chatInput;
    console.log(
      "[RUNWORKFLOW] runId:",
      runId,
      "spaceId:",
      spaceId,
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
        for (const key of LAST_INPUT_KEYS) {
          delete newData[key];
        }
        delete newData.error;
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
        currentNodes[index] = {
          ...currentNodes[index],
          data: { ...oldNode.data, ...data },
        };

        const nodePlugin = pluginRegistry.get(oldNode.type || "");
        if (nodePlugin?.canPauseWorkflow && data.status !== oldNode.data.status) {
          // Mirror status to every storage wired off the bottom handle so
          // multi-storage setups all pulse the same border tint, not just
          // the first connected one.
          const storageEdgesForNode = edges.filter(
            (e) => e.source === nodeId && e.sourceHandle === "storage"
          );
          const newStorageStatus = data.status === "waiting" ? undefined : data.status;
          const newStorageRunId =
            newStorageStatus === undefined ? undefined : data.statusRunId;
          for (const storageEdge of storageEdgesForNode) {
            const storageIndex = currentNodes.findIndex(
              (n) => n.id === storageEdge.target && n.type === "jsonStorage"
            );
            if (storageIndex === -1) continue;
            currentNodes[storageIndex] = {
              ...currentNodes[storageIndex],
              data: {
                ...currentNodes[storageIndex].data,
                status: newStorageStatus,
                statusRunId: newStorageRunId,
              },
            };
            // Live state gets the status delta only — same shape as
            // applyStatus uses below — so a concurrent inspector edit
            // to an unrelated field on the storage node isn't clobbered.
            updateNodeData(spaceId, currentNodes[storageIndex].id, {
              status: newStorageStatus,
              statusRunId: newStorageRunId,
            });
          }
        }
      }
      updateNodeData(spaceId, nodeId, data);
    };

    // Push a status transition to BOTH the run-local working copy (full
    // snapshot — the BFS loop reads it on the next iteration) AND the live
    // session state (delta only — preserves any concurrent inspector edits
    // to unrelated fields). `extraLive` carries additional fields that must
    // reach live state, e.g. the error message on the failure path.
    const applyStatus = (
      nodeId: string,
      baseData: Record<string, unknown>,
      status: string | undefined,
      extraLive: Record<string, unknown> = {}
    ): void => {
      const statusRunId = status === undefined ? undefined : runId;
      const fullForCurrent = { ...baseData, status, statusRunId };
      const liveDelta: Record<string, unknown> = { status, statusRunId, ...extraLive };

      const index = currentNodes.findIndex((n) => n.id === nodeId);
      if (index !== -1) {
        const oldNode = currentNodes[index];
        currentNodes[index] = { ...currentNodes[index], data: fullForCurrent };

        const nodePlugin = pluginRegistry.get(oldNode.type || "");
        if (nodePlugin?.canPauseWorkflow && status !== oldNode.data.status) {
          const storageEdgesForNode = edges.filter(
            (e) => e.source === nodeId && e.sourceHandle === "storage"
          );
          const newStorageStatus = status === "waiting" ? undefined : status;
          const newStorageRunId =
            newStorageStatus === undefined ? undefined : statusRunId;
          for (const storageEdge of storageEdgesForNode) {
            const storageIndex = currentNodes.findIndex(
              (n) => n.id === storageEdge.target && n.type === "jsonStorage"
            );
            if (storageIndex === -1) continue;
            currentNodes[storageIndex] = {
              ...currentNodes[storageIndex],
              data: {
                ...currentNodes[storageIndex].data,
                status: newStorageStatus,
                statusRunId: newStorageRunId,
              },
            };
            updateNodeData(spaceId, currentNodes[storageIndex].id, {
              status: newStorageStatus,
              statusRunId: newStorageRunId,
            });
          }
        }
      }

      updateNodeData(spaceId, nodeId, liveDelta);
    };

    let haltedAtChat = false;

    try {
      // Mirror the init-status pass onto live state in one batched setNodes.
      setNodes(spaceId, (nds) =>
        nds.map((n) => {
          const newData = { ...n.data };
          if (isFreshRun) {
            for (const key of LAST_INPUT_KEYS) {
              delete newData[key];
            }
            delete newData.error;
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

      const ekey = executedKey(spaceId, startKey);
      if (!executedNodeIdsMap.has(ekey)) {
        executedNodeIdsMap.set(ekey, new Set<string>());
      }
      const executedNodeIds = executedNodeIdsMap.get(ekey)!;

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
          applyStatus(
            currentId,
            { ...postExecNode.data, error: errorMessage },
            "error",
            { error: errorMessage }
          );
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
        clearBordersForRuns(spaceId, new Set([runId]));
        const t = fadeTimeouts.get(runId);
        if (t) {
          clearTimeout(t);
          fadeTimeouts.delete(runId);
        }
        activeRuns.delete(runId);
      } else {
        const timeoutId = window.setTimeout(() => {
          setNodes(spaceId, (nds) =>
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

  function cancelWorkflow(spaceId: string, nodeId?: string): void {
    // No-node call: cancel everything **in this space**. No in-tree caller
    // today (Clear-all goes through clearAllStatuses), but kept for API
    // stability. Runs in other spaces are not affected.
    if (!nodeId) {
      const runIdsInSpace = Array.from(activeRuns.entries())
        .filter(([, c]) => c.spaceId === spaceId)
        .map(([rid]) => rid);
      if (runIdsInSpace.length === 0) return;
      for (const rid of runIdsInSpace) {
        const r = activeRuns.get(rid);
        if (!r) continue;
        r.cancelled = true;
        releaseRunCount(rid);
        const t = fadeTimeouts.get(rid);
        if (t) {
          clearTimeout(t);
          fadeTimeouts.delete(rid);
        }
        if (!r.inLoop) activeRuns.delete(rid);
      }
      clearBordersForRuns(spaceId, new Set(runIdsInSpace));
      showToast("Workflow cancelled", "info");
      return;
    }

    const nodes = getNodes(spaceId);
    const edges = getEdges(spaceId);
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // Scope to the node's connected component within `spaceId`. Anything in
    // a different component (a separate workflow) is left alone, so a Stop
    // click on workflow B never reaches into a running workflow A. Storage
    // edges are excluded from the component walk so shared storage nodes
    // don't fuse two flows together.
    const component = getConnectedComponent(nodeId, edges);

    const cancelledRunIds: string[] = [];
    for (const [rid, control] of activeRuns) {
      if (control.spaceId !== spaceId) continue;
      const startIds = control.startKey.split(",");
      if (!startIds.some((id) => component.has(id))) continue;
      control.cancelled = true;
      releaseRunCount(rid);
      const t = fadeTimeouts.get(rid);
      if (t) {
        clearTimeout(t);
        fadeTimeouts.delete(rid);
      }
      if (!control.inLoop) activeRuns.delete(rid);
      cancelledRunIds.push(rid);
    }

    const cancelledRunIdSet = new Set(cancelledRunIds);
    let touched = 0;
    setNodes(spaceId, (nds) =>
      nds.map((n) => {
        if (!component.has(n.id)) return n;
        const rid = n.data?.statusRunId as string | undefined;
        const s = n.data?.status;
        const inCancelledRun = !!rid && cancelledRunIdSet.has(rid);
        const stuck = s === "waiting" || s === "executing" || s === "pending";
        const orphanRid =
          !!rid && !cancelledRunIdSet.has(rid) && !activeRuns.has(rid);
        if (inCancelledRun || stuck || orphanRid) {
          touched += 1;
          return {
            ...n,
            data: {
              ...n.data,
              status: undefined,
              statusRunId: undefined,
              error: undefined,
            },
          };
        }
        return n;
      })
    );

    if (cancelledRunIds.length > 0 || touched > 0) {
      showToast("Workflow cancelled", "info");
    }
  }

  async function executeWorkflow(
    spaceId: string,
    triggerNodeId?: string
  ): Promise<void> {
    const nodes = getNodes(spaceId);
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
    await runWorkflow(spaceId, startNodeIds);
  }

  async function handleChatSend(
    spaceId: string,
    nodeId: string,
    text: string
  ): Promise<void> {
    const chatNode = getNodes(spaceId).find((n) => n.id === nodeId);
    if (!chatNode) return;
    await runWorkflow(spaceId, [nodeId], text);
  }

  async function retryWorkflow(spaceId: string, nodeId: string): Promise<void> {
    const node = getNodes(spaceId).find((n) => n.id === nodeId);
    if (!node) return;
    // Retry implies "fresh slate from this node" — clear leftover borders
    // from runs no longer active so sibling/upstream errors from a previous
    // failed run don't linger across the retry. Nodes still tied to a
    // genuinely active concurrent run are preserved.
    clearOrphanStatusesAggressive(spaceId);
    showToast(`Retrying workflow from ${node.data?.label || node.type}...`, "info");
    await runWorkflow(spaceId, [nodeId]);
  }

  function dispose(): void {
    for (const t of fadeTimeouts.values()) {
      clearTimeout(t);
    }
    fadeTimeouts.clear();
    activeRuns.clear();
    executedNodeIdsMap.clear();
  }

  return {
    executeWorkflow,
    handleChatSend,
    retryWorkflow,
    cancelWorkflow,
    clearAllStatuses,
    hasActiveRuns,
    clearOrphanRunIds,
    dispose,
  };
}
