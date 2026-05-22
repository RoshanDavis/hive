import type { NodeExecutor, ExecutionContext } from "./types";
import { NotifyExecutor } from "./NotifyExecutor";
import { OllamaExecutor } from "./OllamaExecutor";
import { ChatExecutor } from "./ChatExecutor";
import { OutputExecutor } from "./OutputExecutor";
import { getUpstreamNodeData } from "./utils";

export * from "./types";
export * from "./ChatExecutor";

const executors: Record<string, NodeExecutor> = {
  notify: new NotifyExecutor(),
  ollama: new OllamaExecutor(),
  chat: new ChatExecutor(),
  output: new OutputExecutor(),
  outputNode: new OutputExecutor(),
};

export const executeNode = async (
  nodeType: string,
  context: ExecutionContext
): Promise<void> => {
  const executor = executors[nodeType];
  if (executor) {
    await executor.execute(context);
  } else {
    // Passive nodes or nodes without executors (trigger, etc.)
    if (!["trigger"].includes(nodeType)) {
      console.warn(`No executor found for node type: ${nodeType}`);
    }
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
            // Prevent duplicate entries of the same timestamp/content if triggered repeatedly in the same tick
            const isDuplicate = dbRecords.some(
              (rec) => rec.content === payload && Date.now() - Number(rec.id) < 500
            );
            if (!isDuplicate) {
              const newRecord = {
                id: Date.now().toString(),
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                source: String(context.node.data?.label || context.node.type || "Source"),
                content: payload,
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
