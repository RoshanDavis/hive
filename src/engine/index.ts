import type { ExecutionContext } from "./types";
import { executorRegistry } from "./registry";
import { getUpstreamNodeData, getUpstreamNodeEnvelope } from "./utils";
import type { NodeOutputEnvelope } from "./types";

export * from "./types";
export * from "./ChatExecutor";
export { executorRegistry };

export const executeNode = async (
  nodeType: string,
  context: ExecutionContext
): Promise<void> => {
  const executor = executorRegistry.get(nodeType);
  if (executor) {
    await executor.execute(context);
  } else {
    // Passive nodes or nodes without specialized executors (trigger, router, etc.)
    let resolvedEnvelope: NodeOutputEnvelope = { value: "" };

    // Find all incoming edges (excluding storage connections)
    const incomingEdges = context.edges.filter(
      (e) =>
        e.target === context.node.id &&
        e.sourceHandle !== "storage" &&
        e.targetHandle !== "storage"
    );

    if (incomingEdges.length > 0) {
      const upstreamNodes = context.nodes.filter((n) =>
        incomingEdges.some((e) => e.source === n.id)
      );

      for (const upstream of upstreamNodes) {
        // Only allow upstream nodes in the active run path (visited Set)
        if (context.visited && !context.visited.has(upstream.id)) {
          continue;
        }
        resolvedEnvelope = getUpstreamNodeEnvelope(upstream);
        break;
      }
    }

    // Set the resolved upstream envelope (or empty string for trigger nodes) as our response payload
    context.updateNodeData(context.node.id, {
      ...context.node.data,
      lastResponse: resolvedEnvelope.value,
      outputEnvelope: resolvedEnvelope
    });
  }

  // ─── Generic Database Output Sync ───
  // After executing any node (except chat, which handles database sync in ChatExecutor),
  // check if there is a connected JSON storage node with write permissions.
  // If so, write the node's output payload to the storage records!
  if (context.node.type !== "chat") {
    const storageEdges = context.edges.filter((e) => {
      const targetNode = context.nodes.find((n) => n.id === e.target);
      return e.source === context.node.id && targetNode?.type === "jsonStorage";
    });

    for (const edge of storageEdges) {
      const storageEdgeType = (edge.data?.edgeType as string) || "write-only";
      const hasWritePermission = storageEdgeType === "write-only" || storageEdgeType === "read-write";

      if (hasWritePermission) {
        const storageNode = context.nodes.find((n) => n.id === edge.target);
        if (storageNode) {
          const payload = getUpstreamNodeData(context.node);
          if (payload !== null && payload !== undefined) {
            const dbRecords = (storageNode.data?.records as any[]) || [];
            // Prevent duplicate entries of the same content if triggered repeatedly in the same tick
            const isDuplicate = dbRecords.some(
              (rec) => rec.content === payload && Date.now() - Number(rec.id) < 500
            );
            if (!isDuplicate) {
              const envelope = getUpstreamNodeEnvelope(context.node);
              const newRecord = {
                id: Date.now().toString(),
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                source: String(context.node.data?.label || context.node.type || "Source"),
                content: payload,
                envelope: envelope
              };
              context.updateNodeData(storageNode.id, {
                ...storageNode.data,
                records: [...dbRecords, newRecord],
              });
            }
          }
        }
      }
    }
  }
};
