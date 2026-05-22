import type { ExecutionContext, NodeExecutor } from "./types";
import { getUpstreamNodeData } from "./utils";

export class OutputExecutor implements NodeExecutor {
  async execute({ node, nodes, edges, updateNodeData }: ExecutionContext): Promise<void> {
    const incomingEdges = edges.filter(e => e.target === node.id);
    let resolvedMessage = "";

    if (incomingEdges.length > 0) {
      const upstreamNodes = nodes.filter(n => incomingEdges.some(e => e.source === n.id));
      for (const upstream of upstreamNodes) {
        const val = getUpstreamNodeData(upstream);
        if (val !== null) {
          resolvedMessage = val;
          break;
        }
      }
    }

    updateNodeData(node.id, {
      ...node.data,
      outputContent: resolvedMessage,
      lastResponse: resolvedMessage
    });
  }
}
