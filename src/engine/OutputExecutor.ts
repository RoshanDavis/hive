import type { ExecutionContext, NodeExecutor, NodeOutputEnvelope } from "./types";
import { getUpstreamNodeEnvelope, getUpstreamNodes } from "./utils";
import { setOutputEnvelope } from "./nodeData";

export class OutputExecutor implements NodeExecutor {
  async execute(context: ExecutionContext): Promise<void> {
    const { node, nodes, edges, updateNodeData, visited } = context;
    const upstreamNodes = getUpstreamNodes(node.id, edges, nodes, { visited });

    let resolvedMessage = "";
    for (const upstream of upstreamNodes) {
      const env = getUpstreamNodeEnvelope(upstream);
      if (env) {
        resolvedMessage = env.value;
        break;
      }
    }

    const envelope: NodeOutputEnvelope = {
      value: resolvedMessage,
      metadata: { timestamp: new Date().toISOString() },
    };
    updateNodeData(node.id, setOutputEnvelope(node.data, envelope));
  }
}
