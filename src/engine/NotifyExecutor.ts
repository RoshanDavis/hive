import { invoke } from "@tauri-apps/api/core";
import type { ExecutionContext, NodeExecutor } from "./types";
import { getUpstreamNodeData } from "./utils";

export class NotifyExecutor implements NodeExecutor {
  async execute({ node, nodes, edges, updateNodeData, showToast }: ExecutionContext): Promise<void> {
    try {
      let resolvedMessage = "";

      const incomingEdges = edges.filter(e => e.target === node.id);
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

      const customMessage = String(node.data?.message || "Notification from Hive");
      let finalBody = customMessage;

      if (resolvedMessage) {
        const placeholders = [/{input}/gi, /{output}/gi, /{message}/gi, /{response}/gi];
        let hasPlaceholder = false;
        for (const ph of placeholders) {
          ph.lastIndex = 0;
          if (ph.test(customMessage)) {
            hasPlaceholder = true;
            break;
          }
        }

        if (hasPlaceholder) {
          for (const ph of placeholders) {
            ph.lastIndex = 0;
            finalBody = finalBody.replace(ph, resolvedMessage);
          }
        }
      }

      // Store resolved notification body in node state so downstream nodes can read it
      updateNodeData(node.id, {
        ...node.data,
        lastResponse: finalBody
      });

      const label = String(node.data?.label || "Hive");
      await invoke("send_notification", { title: label, body: finalBody });
    } catch (err) {
      showToast(`Notify error: ${err}`, "error");
    }
  }
}
