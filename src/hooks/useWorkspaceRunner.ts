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

interface UseWorkspaceRunnerParams {
  nodes: Node[];
  edges: Edge[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  handleUpdateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  showToast: ShowToastFunc;
}

export function useWorkspaceRunner({
  nodes,
  edges,
  setNodes,
  handleUpdateNodeData,
  showToast,
}: UseWorkspaceRunnerParams) {
  const [runningStartNodeIds, setRunningStartNodeIds] = useState<Set<string>>(new Set<string>());
  const successTimeoutsRef = useRef<Map<string, number>>(new Map());
  const executedNodeIdsMapRef = useRef<Map<string, Set<string>>>(new Map());

  const isRunning = runningStartNodeIds.size > 0;

  const runWorkflow = useCallback(
    async (startNodeIds: string[], chatInput?: string) => {
      const startKey = startNodeIds.join(",");
      setRunningStartNodeIds((prev) => {
        const next = new Set(prev);
        next.add(startKey);
        return next;
      });

      const existingTimeout = successTimeoutsRef.current.get(startKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        successTimeoutsRef.current.delete(startKey);
      }

      if (!chatInput) {
        showToast("Workflow started", "info");
      }

      const isResuming = !!chatInput;

      console.log("[RUNWORKFLOW] startNodeIds:", startNodeIds, "chatInput:", chatInput, "isResuming:", isResuming);

      // Find reachable downstream nodes and any storage nodes connected to starting Chat nodes
      const reachableDownstreamIds = getReachableNodeIds(startNodeIds, edges);
      const startingStorageNodeIds = new Set<string>();
      startNodeIds.forEach((sid) => {
        const connectedEdges = edges.filter(
          (e) => e.source === sid && e.sourceHandle === "storage"
        );
        connectedEdges.forEach((e) => {
          startingStorageNodeIds.add(e.target);
        });
      });

      const nodesToClear = new Set<string>([
        ...startNodeIds,
        ...Array.from(startingStorageNodeIds),
        ...Array.from(reachableDownstreamIds)
      ]);

      console.log("[RUNWORKFLOW] reachableDownstreamIds:", Array.from(reachableDownstreamIds));
      console.log("[RUNWORKFLOW] startingStorageNodeIds:", Array.from(startingStorageNodeIds));

      const hasTriggerStart = startNodeIds.some((sid) => {
        const n = nodes.find((node) => node.id === sid);
        return n?.type && !pluginRegistry.get(n.type)?.executor;
      });
      const isFreshRun = hasTriggerStart || !!chatInput;

      const currentNodes = nodes.map((n) => {
        let newStatus = n.data.status;
        const newData = { ...n.data };

        if (isFreshRun) {
          delete newData.lastInputMessages;
          delete newData.lastInputText;
          delete newData.lastInputSender;
        }

        if (startNodeIds.includes(n.id)) {
          newStatus = undefined;
        } else if (startingStorageNodeIds.has(n.id)) {
          newStatus = "pending";
        } else if (reachableDownstreamIds.has(n.id)) {
          newStatus = "pending";
        }
        console.log(`[RUNWORKFLOW] init node status: ${n.id} (${n.type}) -> old: ${n.data.status}, new: ${newStatus}`);
        return {
          ...n,
          data: {
            ...newData,
            status: newStatus,
          } as Record<string, unknown>,
        };
      });

      const localUpdateNodeData = (nodeId: string, data: Record<string, unknown>) => {
        const index = currentNodes.findIndex((n) => n.id === nodeId);
        if (index !== -1) {
          const oldNode = currentNodes[index];
          console.log(`[RUNWORKFLOW] localUpdateNodeData: ${nodeId} (${oldNode.type}) - status change: ${oldNode.data.status} -> ${data.status}`);
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
              const storageIndex = currentNodes.findIndex((n) => n.id === storageNode.id);
              if (storageIndex !== -1) {
                console.log(`[RUNWORKFLOW] Mirroring chat status to storage ${storageNode.id} (${newStorageStatus})`);
                currentNodes[storageIndex] = {
                  ...currentNodes[storageIndex],
                  data: { ...currentNodes[storageIndex].data, status: newStorageStatus },
                };
                handleUpdateNodeData(storageNode.id, currentNodes[storageIndex].data);
              }
            }
          }
        }
        handleUpdateNodeData(nodeId, data);
      };

      let haltedAtChat = false;
      let hasError = false;

      try {
        // Initialize node statuses in the React flow state
        setNodes((nds) =>
          nds.map((n) => {
            let newStatus = n.data.status;
            const newData = { ...n.data };

            if (isFreshRun) {
              delete newData.lastInputMessages;
              delete newData.lastInputText;
              delete newData.lastInputSender;
              delete newData.lastInputEnvelope;
            }

            if (startNodeIds.includes(n.id)) {
              newStatus = undefined;
            } else if (startingStorageNodeIds.has(n.id)) {
              newStatus = "pending";
            } else if (reachableDownstreamIds.has(n.id)) {
              newStatus = "pending";
            }
            return {
              ...n,
              data: {
                ...newData,
                status: newStatus,
              },
            };
          })
        );

        if (!executedNodeIdsMapRef.current.has(startKey)) {
          executedNodeIdsMapRef.current.set(startKey, new Set<string>());
        }
        const executedNodeIds = executedNodeIdsMapRef.current.get(startKey)!;

        // Clear executed node history if starting from a fresh Trigger node
        const hasTriggerStart = startNodeIds.some((sid) => {
          const n = currentNodes.find((node) => node.id === sid);
          return n?.type && !pluginRegistry.get(n.type)?.executor;
        });
        if (hasTriggerStart) {
          executedNodeIds.clear();
        } else {
          // If starting from a node (e.g. Chat message or Retry), clear all reachable downstream nodes from history
          // so they re-execute freshly to process the new message/signal
          reachableDownstreamIds.forEach((id) => {
            executedNodeIds.delete(id);
          });

          // And find all successfully executed upstream ancestors, and add them to executedNodeIds!
          const ancestors = getAncestorNodeIds(startNodeIds, edges);
          ancestors.forEach((ancId) => {
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
          const currentId = queue.shift()!;
          const isVisited = visited.has(currentId);
          const currentNode = currentNodes.find((n) => n.id === currentId);
          console.log(`[RUNWORKFLOW] Loop iteration. currentId: ${currentId}, type: ${currentNode?.type}, isVisited: ${isVisited}, queue:`, [...queue]);
          if (!currentNode) continue;

          // Normally skip visited nodes, but allow pause-capable nodes (like Chat) to execute again as downstream receivers.
          if (isVisited) {
            const nodePlugin = pluginRegistry.get(currentNode.type || '');
            if (nodePlugin?.canPauseWorkflow) {
              console.log(`[RUNWORKFLOW] Allowing visited ${currentNode.type} node ${currentId} to execute again as downstream receiver.`);
            } else {
              console.log(`[RUNWORKFLOW] Skipping already visited node: ${currentId}`);
              continue;
            }
          }
          visited.add(currentId);

          // Set status to executing
          localUpdateNodeData(currentId, { ...currentNode.data, status: "executing" });
          const updatedNode = currentNodes.find((n) => n.id === currentId)!;

          // Introduce a short visual delay (e.g., 600ms)
          await new Promise<void>((resolve) => setTimeout(resolve, 600));

          const postExecNodePlugin = pluginRegistry.get(updatedNode.type || '');
          const isStartingPauseNode =
            postExecNodePlugin?.canPauseWorkflow && startNodeIds.includes(updatedNode.id) && !isVisited;

          console.log(`[RUNWORKFLOW] Executing node ${currentId} (${updatedNode.type}). isStartingPauseNode: ${isStartingPauseNode}`);

          try {
            await executeNode(updatedNode.type || "default", {
              node: updatedNode,
              nodes: currentNodes,
              edges,
              updateNodeData: localUpdateNodeData,
              showToast,
              chatInput: isStartingPauseNode ? chatInput : undefined,
              visited,
            });

            // Re-fetch the node from currentNodes to ensure we preserve any data updates made during executeNode
            const postExecNode = currentNodes.find((n) => n.id === currentId) || updatedNode;

            // Decide propagation downstream
            // If the node can pause workflow and is NOT a starting node, pause execution downstream
            if (postExecNodePlugin?.canPauseWorkflow && !isStartingPauseNode) {
              const isReturnPath =
                isVisited ||
                edges.some(
                  (e) =>
                    e.source === currentId &&
                    e.data?.edgeType === "bi-directional" &&
                    executedNodeIds.has(e.target)
                );

              if (isReturnPath) {
                console.log(`[RUNWORKFLOW] Chat node ${currentId} return path complete. Setting to success.`);
                localUpdateNodeData(currentId, { ...postExecNode.data, status: "success" });
                executedNodeIds.add(currentId);
                continue;
              } else {
                console.log(`[RUNWORKFLOW] Chat node ${currentId} forward path halted waiting for input. Setting to waiting.`);
                localUpdateNodeData(currentId, { ...postExecNode.data, status: "waiting" });
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
                console.log(`[RUNWORKFLOW] Starting Chat node ${currentId} has bi-directional edge. Setting to pending.`);
                localUpdateNodeData(currentId, { ...postExecNode.data, status: "pending" });
              } else {
                console.log(`[RUNWORKFLOW] Node ${currentId} execution finished. Setting to success.`);
                localUpdateNodeData(currentId, { ...postExecNode.data, status: "success" });
              }
              executedNodeIds.add(currentId);
            }
          } catch (err) {
            console.error(`[RUNWORKFLOW] Error executing node ${currentId}:`, err);
            const postExecNode = currentNodes.find((n) => n.id === currentId) || updatedNode;
            const errorMessage = err instanceof Error ? err.message : String(err);
            localUpdateNodeData(currentId, {
              ...postExecNode.data,
              status: "error",
              error: errorMessage,
            });
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

          console.log(`[RUNWORKFLOW] Propagating from ${currentId} to downstream targets:`, downstreamTargets);
          queue.push(...downstreamTargets);
        }

        if (haltedAtChat) {
          showToast("Workflow paused at Chat. Awaiting message...", "info");
        } else {
          showToast("Workflow completed ✓", "success");
        }
      } catch (err) {
        hasError = true;
        showToast(`Workflow failed: ${err}`, "error");
      } finally {
        console.log("[RUNWORKFLOW] finally block reached. haltedAtChat:", haltedAtChat);

        if (hasError) {
          console.log("[RUNWORKFLOW] Clearing pending/waiting statuses for failed workflow downstream nodes:", startKey);
          currentNodes.forEach((n) => {
            if (nodesToClear.has(n.id)) {
              const latest = currentNodes.find((latestNode) => latestNode.id === n.id);
              if (
                latest &&
                (latest.data.status === "pending" ||
                  latest.data.status === "executing" ||
                  latest.data.status === "waiting")
              ) {
                console.log(`[RUNWORKFLOW] Resetting unreached node status for ${n.id} (${latest.data.status} -> undefined)`);
                localUpdateNodeData(n.id, { ...latest.data, status: undefined });
              }
            }
          });
        }

        if (!hasError) {
          // Keep the green borders visible for 1.5 seconds after the entire workflow completes or halts, then clear success and pending states for this cluster
          const timeoutId = window.setTimeout(() => {
            console.log("[RUNWORKFLOW] Clearing success/pending node statuses for starting cluster:", startKey);
            currentNodes.forEach((n) => {
              if (nodesToClear.has(n.id)) {
                const latest = currentNodes.find((latestNode) => latestNode.id === n.id);
                if (
                  latest &&
                  (latest.data.status === "success" || latest.data.status === "pending")
                ) {
                  console.log(`[RUNWORKFLOW] Clearing status for node ${n.id} (${latest.data.status} -> undefined)`);
                  localUpdateNodeData(n.id, { ...latest.data, status: undefined });
                }
              }
            });
            successTimeoutsRef.current.delete(startKey);
          }, 1500);
          successTimeoutsRef.current.set(startKey, timeoutId);
        }

        setRunningStartNodeIds((prev) => {
          const next = new Set(prev);
          next.delete(startKey);
          return next;
        });
      }
    },
    [nodes, edges, setNodes, showToast, handleUpdateNodeData, setRunningStartNodeIds]
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
  };
}
