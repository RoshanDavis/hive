import type { ExecutionContext, NodeExecutor, NodeOutputEnvelope } from "./types";
import { getUpstreamNodeEnvelope } from "./utils";

export class OutputExecutor implements NodeExecutor {
  async execute(context: ExecutionContext): Promise<void> {
    const { node, nodes, edges, updateNodeData, visited } = context;
    const incomingEdges = edges.filter(e => e.target === node.id);
    let resolvedMessage = "";
    let resolvedEnvelope: NodeOutputEnvelope | null = null;

    if (incomingEdges.length > 0) {
      const upstreamNodes = nodes.filter(n => incomingEdges.some(e => e.source === n.id));
      for (const upstream of upstreamNodes) {
        if (visited && !visited.has(upstream.id)) {
          continue;
        }
        const env = getUpstreamNodeEnvelope(upstream);
        if (env) {
          resolvedEnvelope = env;
          resolvedMessage = env.value;
          break;
        }
      }
    }

    const outputEnvelope: NodeOutputEnvelope = {
      value: resolvedMessage,
      metadata: {
        timestamp: new Date().toISOString()
      },
      data: {
        output: resolvedMessage,
        upstreamEnvelope: resolvedEnvelope
      }
    };

    updateNodeData(node.id, {
      ...node.data,
      outputEnvelope
    });
  }
}
