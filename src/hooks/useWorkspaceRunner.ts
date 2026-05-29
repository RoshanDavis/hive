import { useCallback, useState, useRef } from "react";
import { type Node, type Edge } from "@xyflow/react";
import { executeNode } from "@/engine";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { type ShowToastFunc } from "@/types/workspace";

// Helper to find all reachable downstream nodes on the active workflow execution path
function getReachableNodeIds(startNodeIds: string[], edges: Edge[]): Set<string> {
  const reachable = new Set<string>();
  const queue = [...startNodeIds];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    // Find outgoing edges from this node (ignoring storage edges)
    const outgoing = edges.filter((e) => {
      if (e.sourceHandle === "storage" || e.targetHandle === "storage") return false;
      return (
        e.source === currentId ||
        (e.target === currentId && e.data?.edgeType === "bi-directional")
      );
    });

    outgoing.forEach((e) => {
      const nextId = e.source === currentId ? e.target : e.source;
      if (!startNodeIds.includes(nextId)) {
        reachable.add(nextId);
        queue.push(nextId);
      }
    });
  }

  return reachable;
}

// Helper to find all ancestor nodes that can reach the startNodeIds
function getAncestorNodeIds(startNodeIds: string[], edges: Edge[]): Set<string> {
  const ancestors = new Set<string>();
  const queue = [...startNodeIds];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    // Find incoming edges to this node (ignoring storage edges)
    const incoming = edges.filter((e) => {
      if (e.sourceHandle === "storage" || e.targetHandle === "storage") return false;
      return (
        e.target === currentId ||
        (e.source === currentId && e.data?.edgeType === "bi-directional")
      );
    });

    incoming.forEach((e) => {
      const prevId = e.target === currentId ? e.source : e.target;
      if (!startNodeIds.includes(prevId)) {
        ancestors.add(prevId);
        queue.push(prevId);
      }
    });
  }

  return ancestors;
}

// How long the solid-green / pending borders linger after a workflow terminates before they fade out.
const FADE_DELAY_MS = 1500;

interface UseWorkspaceRunnerParams {
  nodes: Node[];
  edges: Edge[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  handleUpdateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  showToast: ShowToastFunc;
  workspacePath: string;
}

interface RunControl {
  startKey: string;
  cancelled: boolean;
  // True while the run loop is still executing. Once false, the run is in its
  // post-loop fade window and can be torn down directly by a cancel.
  inLoop: boolean;
  // Guards the running-count decrement so a run is only ever released once,
  // even though both the run's finally and a cancel can race to release it.
  countReleased: boolean;
}

export function useWorkspaceRunner({
  nodes,
  edges,
  setNodes,
  handleUpdateNodeData,
  showToast,
  workspacePath,
}: UseWorkspaceRunnerParams) {
  // Ref-counted by start signature so concurrent runs of the same workflow don't collide:
  // a Set would store one entry for two runs, so finishing one would mark the other stopped.
  const [runningStartNodeIds, setRunningStartNodeIds] = useState<Map<string, number>>(
    new Map<string, number>()
  );
  // Pending fade-out timers, keyed by runId so a stale timer can never clear a newer run's borders.
  const fadeTimeoutsRef = useRef<Map<string, number>>(new Map());
  // Re-execution bookkeeping, keyed by the workflow's start signature.
  const executedNodeIdsMapRef = useRef<Map<string, Set<string>>>(new Map());
  // Every active run gets a control record so it can be cancelled mid-flight.
  const activeRunsRef = useRef<Map<string, RunControl>>(new Map());
  const runCounterRef = useRef(0);

  const isRunning = runningStartNodeIds.size > 0;

  const isCancelled = useCallback(
    (runId: string) => activeRunsRef.current.get(runId)?.cancelled === true,
    []
  );

  // Drop a run from the running ref-count exactly once. Decrements the count for the
  // run's start signature and removes the key only when it reaches zero.
  const releaseRunCount = useCallback((runId: string) => {
    const control = activeRunsRef.current.get(runId);
    if (!control || control.countReleased) return;
    control.countReleased = true;
    const key = control.startKey;
    setRunningStartNodeIds((prev) => {
      const next = new Map(prev);
      const count = (next.get(key) ?? 0) - 1;
      if (count > 0) next.set(key, count);
      else next.delete(key);
      return next;
    });
  }, []);

  // Clear the status borders for every node owned by the given run ids.
  // `error`/`waiting` are cleared too here because cancelling is a hard stop.
  const clearBordersForRuns = useCallback(
    (runIds: Set<string>) => {
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
    },
    [setNodes]
  );

  const runWorkflow = useCallback(
    async (startNodeIds: string[], chatInput?: string) => {
      const startKey = startNodeIds.join(",");
      const runId = `${++runCounterRef.current}-${Date.now()}`;
      activeRunsRef.current.set(runId, { startKey, cancelled: false, inLoop: true, countReleased: false });

      setRunningStartNodeIds((prev) => {
        const next = new Map(prev);
        next.set(startKey, (next.get(startKey) ?? 0) + 1);
        return next;
      });

      if (!chatInput) {
        showToast("Workflow started", "info");
      }

      const isResuming = !!chatInput;

      console.log("[RUNWORKFLOW] runId:", runId, "startNodeIds:", startNodeIds, "isResuming:", isResuming);

      // Find reachable downstream nodes and any storage nodes connected to starting Chat nodes
      const reachableDownstreamIds = getReachableNodeIds(startNodeIds, edges);
      // Ancestors of the start node(s). Used to (a) re-seed already-run upstream nodes on a
      // retry, and (b) recognize a pause node reached via a loop-back as a return path (end)
      // rather than a fresh forward halt (waiting for input).
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

      // A node is "in scope" for this run if the run is responsible for its status.
      // Out-of-scope nodes (e.g. successful ancestors during a retry, or another
      // workflow's nodes) keep their existing status & run ownership untouched so we
      // never clobber a different run's borders.
      const inScope = (nodeId: string): boolean =>
        startNodeIds.includes(nodeId) ||
        startingStorageNodeIds.has(nodeId) ||
        reachableDownstreamIds.has(nodeId);

      // The status an in-scope node should start the run with.
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

      // Stamp `statusRunId` alongside every status write so cleanup can tell which run owns a node.
      const localUpdateNodeData = (nodeId: string, data: Record<string, unknown>) => {
        const index = currentNodes.findIndex((n) => n.id === nodeId);
        if (index !== -1) {
          const oldNode = currentNodes[index];
          currentNodes[index] = { ...currentNodes[index], data: { ...data } };

          // Mirror status updates onto connected storage nodes for pause-capable nodes
          const nodePlugin = pluginRegistry.get(oldNode.type || '');
          if (nodePlugin?.canPauseWorkflow && data.status !== oldNode.data.status) {
            const storageEdge = edges.find(
              (e) => e.source === nodeId && e.sourceHandle === "storage"
            );
            const storageNode = storageEdge
              ? currentNodes.find((n) => n.id === storageEdge.target && n.type === "jsonStorage")
              : null;

            if (storageNode) {
              const newStorageStatus = data.status === "waiting" ? undefined : data.status;
              const newStorageRunId = newStorageStatus === undefined ? undefined : data.statusRunId;
              const storageIndex = currentNodes.findIndex((n) => n.id === storageNode.id);
              if (storageIndex !== -1) {
                currentNodes[storageIndex] = {
                  ...currentNodes[storageIndex],
                  data: { ...currentNodes[storageIndex].data, status: newStorageStatus, statusRunId: newStorageRunId },
                };
                handleUpdateNodeData(storageNode.id, currentNodes[storageIndex].data);
              }
            }
          }
        }
        handleUpdateNodeData(nodeId, data);
      };

      // Write a status transition for a node, stamping the owning run.
      const applyStatus = (nodeId: string, baseData: Record<string, unknown>, status: string | undefined) => {
        localUpdateNodeData(nodeId, {
          ...baseData,
          status,
          statusRunId: status === undefined ? undefined : runId,
        });
      };

      let haltedAtChat = false;

      try {
        // Initialize node statuses in the React flow state
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

        if (!executedNodeIdsMapRef.current.has(startKey)) {
          executedNodeIdsMapRef.current.set(startKey, new Set<string>());
        }
        const executedNodeIds = executedNodeIdsMapRef.current.get(startKey)!;

        if (hasTriggerStart) {
          executedNodeIds.clear();
        } else {
          // If starting from a node (e.g. Chat message or Retry), clear all reachable downstream nodes from history
          // so they re-execute freshly to process the new message/signal
          reachableDownstreamIds.forEach((id) => {
            executedNodeIds.delete(id);
          });

          // And find all successfully executed upstream ancestors, and add them to executedNodeIds!
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

          // Normally skip visited nodes, but allow pause-capable nodes (like Chat) to execute again as downstream receivers.
          if (isVisited) {
            const nodePlugin = pluginRegistry.get(currentNode.type || '');
            if (!nodePlugin?.canPauseWorkflow) {
              continue;
            }
          }
          visited.add(currentId);

          // Set status to executing
          applyStatus(currentId, currentNode.data, "executing");
          const updatedNode = currentNodes.find((n) => n.id === currentId)!;

          // Introduce a short visual delay (e.g., 600ms)
          await new Promise<void>((resolve) => setTimeout(resolve, 600));
          if (isCancelled(runId)) break;

          const postExecNodePlugin = pluginRegistry.get(updatedNode.type || '');
          const isStartingPauseNode =
            postExecNodePlugin?.canPauseWorkflow && startNodeIds.includes(updatedNode.id) && !isVisited;

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

            // A cancel may have landed while the executor was awaiting (e.g. a network call).
            if (isCancelled(runId)) break;

            // Re-fetch the node from currentNodes to ensure we preserve any data updates made during executeNode
            const postExecNode = currentNodes.find((n) => n.id === currentId) || updatedNode;

            // Decide propagation downstream
            // If the node can pause workflow and is NOT a starting node, pause execution downstream
            if (postExecNodePlugin?.canPauseWorkflow && !isStartingPauseNode) {
              // A pause node reached as a receiver is a return path (ends the cycle) when:
              //  - it already ran earlier in this run (isVisited — e.g. the originating Chat), or
              //  - execution looped back to a node upstream of the start (ancestorIds — e.g. a
              //    retry from a mid-loop node lands back on the originating Chat), or
              //  - a bi-directional edge points to an already-executed node.
              // Otherwise it's a fresh forward halt waiting for user input.
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
              // It's the starting chat node or a regular node.
              // If it's a Chat node and has a bi-directional edge, set status to "pending" (blue border)
              // to indicate it is actively waiting for its bi-directional reply.
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
            // If the run was cancelled, swallow the abort rather than surfacing it as an error.
            if (isCancelled(runId)) break;
            console.error(`[RUNWORKFLOW] Error executing node ${currentId}:`, err);
            const postExecNode = currentNodes.find((n) => n.id === currentId) || updatedNode;
            const errorMessage = err instanceof Error ? err.message : String(err);
            applyStatus(currentId, { ...postExecNode.data, error: errorMessage }, "error");
            throw err;
          }

          // Propagate to logic downstream targets
          const downstreamTargets = edges
            .filter((e) => {
              // Ignore storage connections
              if (e.sourceHandle === "storage" || e.targetHandle === "storage") return false;

              // Exclude connections to/from jsonStorage nodes
              const srcNode = currentNodes.find((n) => n.id === e.source);
              const tgtNode = currentNodes.find((n) => n.id === e.target);
              const srcPlugin = pluginRegistry.get(srcNode?.type || '');
              const tgtPlugin = pluginRegistry.get(tgtNode?.type || '');
              if (srcPlugin?.meta.category === 'storage' || tgtPlugin?.meta.category === 'storage') return false;

              // Propagate if normal forward edge OR bi-directional edge from target back to source
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
        // The run loop has exited; mark it so a late cancel can tear it down directly.
        const control = activeRunsRef.current.get(runId);
        if (control) control.inLoop = false;

        // Always drop this run from the running ref-count.
        releaseRunCount(runId);

        if (isCancelled(runId)) {
          // cancelWorkflow already cleared the borders for this run; a late executor write
          // may have re-stamped a node, so clear once more to be safe, then tear down.
          clearBordersForRuns(new Set([runId]));
          const t = fadeTimeoutsRef.current.get(runId);
          if (t) {
            clearTimeout(t);
            fadeTimeoutsRef.current.delete(runId);
          }
          activeRunsRef.current.delete(runId);
        } else {
          // Terminal cleanup for both success and error: linger briefly, then fade out every node
          // this run still owns. `error` (red) and `waiting` (yellow, awaiting user input) are kept;
          // `success`/`pending`/`executing` fade back to idle.
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
            fadeTimeoutsRef.current.delete(runId);
            activeRunsRef.current.delete(runId);
          }, FADE_DELAY_MS);
          fadeTimeoutsRef.current.set(runId, timeoutId);
        }
      }
    },
    [nodes, edges, setNodes, showToast, handleUpdateNodeData, workspacePath, isCancelled, clearBordersForRuns, releaseRunCount]
  );

  // Stop running/waiting workflows. With a nodeId, cancels just the run that owns that node;
  // otherwise cancels every active run.
  const cancelWorkflow = useCallback(
    (nodeId?: string) => {
      const runs = activeRunsRef.current;
      if (runs.size === 0) return;

      let targetRunIds: string[];
      if (nodeId) {
        const node = nodes.find((n) => n.id === nodeId);
        const rid = node?.data?.statusRunId as string | undefined;
        // Only cancel the run that actually owns this node. If the node has no live
        // run, do nothing — never fall back to cancelling every active workflow.
        if (!rid || !runs.has(rid)) return;
        targetRunIds = [rid];
      } else {
        targetRunIds = Array.from(runs.keys());
      }

      const cancelledSet = new Set(targetRunIds);

      targetRunIds.forEach((rid) => {
        const r = runs.get(rid);
        if (!r) return;
        r.cancelled = true;
        // Release the running ref-count now for snappy UI; the run's finally is guarded
        // against a double release, so it won't decrement again when its loop exits.
        releaseRunCount(rid);
        const t = fadeTimeoutsRef.current.get(rid);
        if (t) {
          clearTimeout(t);
          fadeTimeoutsRef.current.delete(rid);
        }
        // If the loop already exited (fade window), tear down now.
        // Otherwise the still-running loop's finally will clean up when it sees `cancelled`.
        if (!r.inLoop) {
          runs.delete(rid);
        }
      });

      clearBordersForRuns(cancelledSet);

      showToast("Workflow cancelled", "info");
    },
    [nodes, clearBordersForRuns, showToast, releaseRunCount]
  );

  const executeWorkflow = useCallback(
    async (triggerNodeId?: string) => {
      let triggerNodes = nodes.filter((n) => {
        const plugin = pluginRegistry.get(n.type || '');
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
    },
    [nodes, runWorkflow, showToast]
  );

  const handleChatSend = useCallback(
    async (nodeId: string, text: string) => {
      const chatNode = nodes.find((n) => n.id === nodeId);
      if (!chatNode) return;

      await runWorkflow([nodeId], text);
    },
    [nodes, runWorkflow]
  );

  const retryWorkflow = useCallback(
    async (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      showToast(`Retrying workflow from ${node.data?.label || node.type}...`, "info");
      await runWorkflow([nodeId]);
    },
    [nodes, runWorkflow, showToast]
  );

  return {
    isRunning,
    runningStartNodeIds,
    executeWorkflow,
    handleChatSend,
    retryWorkflow,
    cancelWorkflow,
  };
}
