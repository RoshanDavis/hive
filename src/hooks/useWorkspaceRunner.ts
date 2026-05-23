import { useCallback, useState, useRef } from "react";
import { type Node, type Edge } from "@xyflow/react";
import { executeNode } from "@/engine";
import { type ShowToastFunc } from "@/types/workspace";

interface WorkflowController {
  isPaused: boolean;
  isAborted: boolean;
  resumePromiseResolve?: () => void;
}

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
  const workflowControllersRef = useRef<Map<string, WorkflowController>>(new Map());
  const activeNodeToStartKeyRef = useRef<Map<string, string>>(new Map());

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

      nodesToClear.forEach((nodeId) => {
        activeNodeToStartKeyRef.current.set(nodeId, startKey);
      });

      const newController: WorkflowController = { isPaused: false, isAborted: false };
      workflowControllersRef.current.set(startKey, newController);

      console.log("[RUNWORKFLOW] reachableDownstreamIds:", Array.from(reachableDownstreamIds));
      console.log("[RUNWORKFLOW] startingStorageNodeIds:", Array.from(startingStorageNodeIds));

      const currentNodes = nodes.map((n) => {
        let newStatus = n.data.status;
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
            ...n.data,
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

          // Mirror Chat node status updates onto connected JSON storage node (ignoring "waiting")
          if (oldNode.type === "chat" && data.status !== oldNode.data.status) {
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

      try {
        // Initialize node statuses in the React flow state
        setNodes((nds) =>
          nds.map((n) => {
            let newStatus = n.data.status;
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
                ...n.data,
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
          return n?.type === "trigger";
        });
        if (hasTriggerStart) {
          executedNodeIds.clear();
        } else {
          // If starting from a node (e.g. Chat message), clear all reachable downstream nodes from history
          // so they re-execute freshly to process the new message/signal
          reachableDownstreamIds.forEach((id) => {
            executedNodeIds.delete(id);
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

          // Normally skip visited nodes, but allow Chat nodes to be executed a second time as a downstream receiver.
          if (isVisited) {
            if (currentNode.type === "chat") {
              console.log(`[RUNWORKFLOW] Allowing visited Chat node ${currentId} to execute again as downstream receiver.`);
            } else {
              console.log(`[RUNWORKFLOW] Skipping already visited node: ${currentId}`);
              continue;
            }
          }
          visited.add(currentId);

          // Check execution control signals
          const controller = workflowControllersRef.current.get(startKey);
          if (controller) {
            // 1. Abort Check
            if (controller.isAborted) {
              console.log(`[RUNWORKFLOW] Workflow ${startKey} aborted before executing ${currentId}.`);
              break;
            }

            // 2. Pause Check
            if (controller.isPaused) {
              console.log(`[RUNWORKFLOW] Workflow ${startKey} paused. Yielding execution before ${currentId}.`);
              localUpdateNodeData(currentId, { ...currentNode.data, status: "waiting" });
              await new Promise<void>((resolve) => {
                controller.resumePromiseResolve = resolve;
              });
              console.log(`[RUNWORKFLOW] Workflow ${startKey} resumed. Continuing execution for ${currentId}.`);
            }
          }

          // Set status to executing
          localUpdateNodeData(currentId, { ...currentNode.data, status: "executing" });
          const updatedNode = currentNodes.find((n) => n.id === currentId)!;

          // Introduce a short visual delay (e.g., 600ms) so the user can easily see the "executing" state pulse
          await new Promise((resolve) => setTimeout(resolve, 600));

          // 1. Execute the current node
          const isStartingChatNode =
            updatedNode.type === "chat" && startNodeIds.includes(updatedNode.id) && !isVisited;

          console.log(`[RUNWORKFLOW] Executing node ${currentId} (${updatedNode.type}). isStartingChatNode: ${isStartingChatNode}`);

          try {
            await executeNode(updatedNode.type || "default", {
              node: updatedNode,
              nodes: currentNodes,
              edges,
              updateNodeData: localUpdateNodeData,
              showToast,
              chatInput: isStartingChatNode ? chatInput : undefined,
              visited,
            });

            // Re-fetch the node from currentNodes to ensure we preserve any data updates made during executeNode
            const postExecNode = currentNodes.find((n) => n.id === currentId) || updatedNode;

            // Decide propagation downstream
            // If the node is a chat node and is NOT a starting node, pause execution downstream
            if (postExecNode.type === "chat" && !isStartingChatNode) {
              if (isVisited) {
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
              if (postExecNode.type === "chat" && hasBiDirectionalEdge) {
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
              if (srcNode?.type === "jsonStorage" || tgtNode?.type === "jsonStorage") return false;

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
        showToast(`Workflow failed: ${err}`, "error");
      } finally {
        console.log("[RUNWORKFLOW] finally block reached. haltedAtChat:", haltedAtChat);

        const controller = workflowControllersRef.current.get(startKey);
        const wasAborted = controller?.isAborted || false;

        // Clean up active mapping and controllers
        workflowControllersRef.current.delete(startKey);
        nodesToClear.forEach((nodeId) => {
          activeNodeToStartKeyRef.current.delete(nodeId);
        });

        if (wasAborted) {
          console.log("[RUNWORKFLOW] Clearing statuses for aborted workflow nodes:", startKey);
          currentNodes.forEach((n) => {
            if (nodesToClear.has(n.id)) {
              const latest = currentNodes.find((latestNode) => latestNode.id === n.id);
              if (
                latest &&
                (latest.data.status === "success" ||
                  latest.data.status === "pending" ||
                  latest.data.status === "executing" ||
                  latest.data.status === "waiting")
              ) {
                console.log(`[RUNWORKFLOW] Clearing status for node ${n.id} (${latest.data.status} -> undefined)`);
                localUpdateNodeData(n.id, { ...latest.data, status: undefined });
              }
            }
          });
        }

        if (!haltedAtChat && !wasAborted) {
          // Keep the green borders visible for 1.5 seconds after the entire workflow completes/fails, then clear success and pending states for this cluster
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
      let triggerNodes = nodes.filter((n) => n.type === "trigger");
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

  const pauseWorkflow = useCallback((nodeId: string) => {
    const startKey = activeNodeToStartKeyRef.current.get(nodeId);
    if (!startKey) return;
    const controller = workflowControllersRef.current.get(startKey);
    if (controller) {
      controller.isPaused = true;
      showToast("Workflow execution paused", "info");
      setNodes((nds) =>
        nds.map((n) => {
          if (activeNodeToStartKeyRef.current.get(n.id) === startKey && n.data.status === "executing") {
            return { ...n, data: { ...n.data, status: "waiting" } };
          }
          return n;
        })
      );
    }
  }, [showToast, setNodes]);

  const resumeWorkflow = useCallback((nodeId: string) => {
    const startKey = activeNodeToStartKeyRef.current.get(nodeId);
    if (!startKey) return;
    const controller = workflowControllersRef.current.get(startKey);
    if (controller && controller.isPaused) {
      controller.isPaused = false;
      if (controller.resumePromiseResolve) {
        controller.resumePromiseResolve();
        controller.resumePromiseResolve = undefined;
      }
    }
  }, []);

  const stopWorkflow = useCallback((nodeId: string) => {
    const startKey = activeNodeToStartKeyRef.current.get(nodeId);
    if (!startKey) return;
    const controller = workflowControllersRef.current.get(startKey);
    if (controller) {
      controller.isAborted = true;
      if (controller.isPaused && controller.resumePromiseResolve) {
        controller.resumePromiseResolve();
        controller.resumePromiseResolve = undefined;
      }
      showToast("Workflow execution stopped", "info");
    }
  }, [showToast]);

  const getWorkflowControlState = useCallback((nodeId: string) => {
    const startKey = activeNodeToStartKeyRef.current.get(nodeId);
    const node = nodes.find((n) => n.id === nodeId);
    const hasError = node?.data?.status === "error";

    if (!startKey) {
      return { isRunning: false, isPaused: false, hasError };
    }
    const controller = workflowControllersRef.current.get(startKey);
    if (!controller) {
      return { isRunning: false, isPaused: false, hasError };
    }
    return {
      isRunning: true,
      isPaused: controller.isPaused,
      hasError
    };
  }, [nodes]);

  return {
    isRunning,
    runningStartNodeIds,
    executeWorkflow,
    handleChatSend,
    retryWorkflow,
    pauseWorkflow,
    resumeWorkflow,
    stopWorkflow,
    getWorkflowControlState,
  };
}
