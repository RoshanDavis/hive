import type { ExecutionContext } from "./types";
import { pluginRegistry } from "./pluginRegistry";
import {
  getUpstreamNodeData,
  getUpstreamNodeEnvelope,
  getUpstreamNodes,
  resolveEdgePermissions,
} from "./utils";
import { getStorageRecords, setOutputEnvelope } from "./nodeData";
import type { NodeOutputEnvelope } from "./types";

export * from "./types";
export { pluginRegistry };

export const executeNode = async (
  nodeType: string,
  context: ExecutionContext
): Promise<void> => {
  const plugin = pluginRegistry.get(nodeType);
  const executor = plugin?.executor;

  if (executor) {
    await executor.execute(context);
  } else {
    // Passive nodes or nodes without specialized executors (trigger, router, etc.)
    let resolvedEnvelope: NodeOutputEnvelope = { value: "" };

    const upstreamNodes = getUpstreamNodes(
      context.node.id,
      context.edges,
      context.nodes,
      { visited: context.visited, excludeStorageHandles: true }
    );

    for (const upstream of upstreamNodes) {
      resolvedEnvelope = getUpstreamNodeEnvelope(upstream);
      break;
    }

    // Set the resolved upstream envelope (or empty string for trigger nodes) as our response payload
    context.updateNodeData(
      context.node.id,
      setOutputEnvelope(context.node.data, resolvedEnvelope)
    );
  }

  // ─── Post-Execution Storage Sync Middleware ───
  // After executing any node, check if there is a connected JSON storage node with write permissions.
  // Nodes that handle their own storage sync (e.g. ChatExecutor) set skipStorageSync = true in their plugin.
  const shouldSyncStorage = !plugin?.skipStorageSync;

  if (shouldSyncStorage) {
    const storageEdges = context.edges.filter((e) => {
      const targetNode = context.nodes.find((n) => n.id === e.target);
      const targetPlugin = pluginRegistry.get(targetNode?.type || '');
      return e.source === context.node.id && targetPlugin?.meta.category === 'storage';
    });

    for (const edge of storageEdges) {
      const { hasWrite: hasWritePermission } = resolveEdgePermissions(edge, "write-only");

      if (hasWritePermission) {
        const storageNode = context.nodes.find((n) => n.id === edge.target);
        if (storageNode) {
          const payload = getUpstreamNodeData(context.node);
          if (payload !== null && payload !== undefined) {
            const dbRecords = getStorageRecords(storageNode.data);
            const recordSource = String(context.node.data?.label || context.node.type || "Source");
            // Prevent duplicate entries from the SAME emitter if triggered repeatedly in the
            // same tick. Scoped by source so distinct upstream nodes writing identical content
            // (fan-in) are not collapsed into one record.
            const isDuplicate = dbRecords.some(
              (rec) =>
                rec.content === payload &&
                rec.source === recordSource &&
                Date.now() - Number(rec.id) < 500
            );
            if (!isDuplicate) {
              const envelope = getUpstreamNodeEnvelope(context.node);
              const newRecord = {
                id: Date.now().toString(),
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                source: recordSource,
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
