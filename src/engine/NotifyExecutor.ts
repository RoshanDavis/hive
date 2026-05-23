import { invoke } from "@tauri-apps/api/core";
import type { ExecutionContext, NodeExecutor } from "./types";
import { getUpstreamNodeData } from "./utils";

export class NotifyExecutor implements NodeExecutor {
  async execute(context: ExecutionContext): Promise<void> {
    const { node, nodes, edges, updateNodeData, showToast, visited } = context;
    try {
      let resolvedMessage = "";

      const incomingEdges = edges.filter(e => e.target === node.id);
      if (incomingEdges.length > 0) {
        const upstreamNodes = nodes.filter(n => incomingEdges.some(e => e.source === n.id));

        for (const upstream of upstreamNodes) {
          if (visited && !visited.has(upstream.id)) {
            continue;
          }
          const val = getUpstreamNodeData(upstream);
          if (val !== null) {
            resolvedMessage = val;
            break;
          }
        }
      }

      // 1. Resolve notification body: message field (defaults to "Hello from Hive!")
      const customMessage = String(node.data?.message !== undefined ? node.data.message : "Hello from Hive!");
      const finalNotificationBody = customMessage.replace(/{input}/gi, resolvedMessage || "");

      // 2. Resolve output template field (defaults to "{input}")
      const outputTemplate = String(node.data?.output !== undefined ? node.data.output : "{input}");
      const finalOutputBody = outputTemplate.replace(/{input}/gi, resolvedMessage || "");

      // Store fully evaluated output body in node state so downstream nodes can read it
      updateNodeData(node.id, {
        ...node.data,
        lastResponse: finalOutputBody
      });

      const label = String(node.data?.label || "Hive");
      await invoke("send_notification", { title: label, body: finalNotificationBody });
    } catch (err) {
      showToast(`Notify error: ${err}`, "error");
      throw err;
    }
  }
}
