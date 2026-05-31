/**
 * Workflow run loop. Extracted from `RunnerSession` so the BFS traversal,
 * status state machine, retry/cancel controls, and fade-timer bookkeeping can
 * be reasoned about (and tested) in isolation from session lifecycle, canvas
 * state, and persistence.
 *
 * The loop owns its own internal state — `activeRuns`, `executedNodeIdsMap`,
 * `runCounter`, `fadeTimeouts` — and reads/writes session-visible state via
 * the {@link RunLoopDeps} callbacks. The session owns the snapshot-visible
 * `runningStartNodeIds` map and bumps it via `adjustRunningStartCount`, so
 * subscribers see active-run transitions through the existing snapshot path.
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

/** How long a completed run's success/pending borders linger before fading. */
const FADE_DELAY_MS = 1500;

interface RunControl {
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
  getNodes(): Node[];
  getEdges(): Edge[];
  setNodes(updater: Node[] | ((prev: Node[]) => Node[])): void;
  updateNodeData(nodeId: string, data: Record<string, unknown>): void;
  showToast(msg: string, type: "success" | "error" | "info"): void;
  /** Push a delta (positive on run start, negative on run release) to the
   * snapshot-visible `runningStartNodeIds` map held by the session. */
  adjustRunningStartCount(startKey: string, delta: number): void;
}

export interface RunLoop {
  executeWorkflow(triggerNodeId?: string): Promise<void>;
  handleChatSend(nodeId: string, text: string): Promise<void>;
  retryWorkflow(nodeId: string): Promise<void>;
  /** Cancel one workflow scoped to a node's connected component, or all
   * active runs if `nodeId` is omitted. */
  cancelWorkflow(nodeId?: string): void;
  /** End every active run AND wipe status/statusRunId/error on every node. */
  clearAllStatuses(): void;
  /** True if any run is still in its BFS loop (excludes runs in fade window). */
  hasActiveRuns(): boolean;
  /** Drop linkage on any persisted statusRunId that no longer references a
   * live run. Preserves status/error so the user still sees what happened. */
  clearOrphanRunIds(): void;
  /** Shut down internal timers/state. Called when the session disposes. */
  dispose(): void;
}

export function createRunLoop(deps: RunLoopDeps): RunLoop {
  const { workspacePath, getNodes, getEdges, setNodes, updateNodeData, showToast } = deps;

  const activeRuns: Map<string, RunControl> = new Map();
  const executedNodeIdsMap: Map<string, Set<string>> = new Map();
  const fadeTimeouts: Map<string, number> = new Map();
  let runCounter = 0;

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
    deps.adjustRunningStartCount(control.startKey, -1);
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

  function clearOrphanRunIds(): void {
    setNodes((nds) =>
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
   * on every node NOT currently part of an active run. Nodes still tied to
   * an in-flight workflow (e.g. a concurrent run) are left alone. */
  function clearOrphanStatusesAggressive(): void {
    setNodes((nds) =>
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

  function clearAllStatuses(): void {
    const allRunIds = Array.from(activeRuns.keys());
    for (const rid of allRunIds) {
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

    let touched = 0;
    setNodes((nds) =>
      nds.map((n) => {
        if (!n.data.status && !n.data.statusRunId && !n.data.error) return n;
        touched += 1;
        return {
          ...n,
          data: { ...n.data, status: undefined, statusRunId: undefined, error: undefined },
        };
      })
    );

    if (allRunIds.length > 0 && touched > 0) {
      showToast(
        `Cancelled ${allRunIds.length} workflow${allRunIds.length === 1 ? "" : "s"} and cleared ${touched} node${touched === 1 ? "" : "s"}`,
        "info"
      );
    } else if (allRunIds.length > 0) {
      showToast(
        `Cancelled ${allRunIds.length} workflow${allRunIds.length === 1 ? "" : "s"}`,
        "info"
      );
    } else if (touched > 0) {
      showToast(`Cleared status on ${touched} node${touched === 1 ? "" : "s"}`, "info");
    }
  }

  async function runWorkflow(startNodeIds: string[], chatInput?: string): Promise<void> {
    const nodes = getNodes();
    const edges = getEdges();
    const startKey = startNodeIds.join(",");
    const runId = `${++runCounter}-${Date.now()}`;
    activeRuns.set(runId, {
      startKey,
      cancelled: false,
      inLoop: true,
      countReleased: false,
    });

    deps.adjustRunningStartCount(startKey, 1);

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
          const storageEdge = edges.find(
            (e) => e.source === nodeId && e.sourceHandle === "storage"
          );
          const storageNode = storageEdge
            ? currentNodes.find(
                (n) => n.id === storageEdge.target && n.type === "jsonStorage"
              )
            : null;
          if (storageNode) {
            const newStorageStatus = status === "waiting" ? undefined : status;
            const newStorageRunId =
              newStorageStatus === undefined ? undefined : statusRunId;
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
              updateNodeData(storageNode.id, {
                status: newStorageStatus,
                statusRunId: newStorageRunId,
              });
            }
          }
        }
      }

      updateNodeData(nodeId, liveDelta);
    };

    let haltedAtChat = false;

    try {
      // Mirror the init-status pass onto live state in one batched setNodes.
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
    // No-node call: cancel everything. No in-tree caller today (Clear-all goes
    // through clearAllStatuses), but kept for API stability.
    if (!nodeId) {
      if (activeRuns.size === 0) return;
      const allRunIds = Array.from(activeRuns.keys());
      for (const rid of allRunIds) {
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
      clearBordersForRuns(new Set(allRunIds));
      showToast("Workflow cancelled", "info");
      return;
    }

    const nodes = getNodes();
    const edges = getEdges();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // Scope to the node's connected component. Anything in a different
    // component (a separate workflow) is left alone, so a Stop click on
    // workflow B never reaches into a running workflow A. Storage edges
    // are excluded from the component walk so shared storage nodes don't
    // fuse two flows together.
    const component = getConnectedComponent(nodeId, edges);

    const cancelledRunIds: string[] = [];
    for (const [rid, control] of activeRuns) {
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
    setNodes((nds) =>
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

  async function executeWorkflow(triggerNodeId?: string): Promise<void> {
    const nodes = getNodes();
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
    const chatNode = getNodes().find((n) => n.id === nodeId);
    if (!chatNode) return;
    await runWorkflow([nodeId], text);
  }

  async function retryWorkflow(nodeId: string): Promise<void> {
    const node = getNodes().find((n) => n.id === nodeId);
    if (!node) return;
    // Retry implies "fresh slate from this node" — clear leftover borders
    // from runs no longer active so sibling/upstream errors from a previous
    // failed run don't linger across the retry. Nodes still tied to a
    // genuinely active concurrent run are preserved.
    clearOrphanStatusesAggressive();
    showToast(`Retrying workflow from ${node.data?.label || node.type}...`, "info");
    await runWorkflow([nodeId]);
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
