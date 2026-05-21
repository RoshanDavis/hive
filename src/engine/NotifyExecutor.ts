import { invoke } from "@tauri-apps/api/core";
import type { ExecutionContext, NodeExecutor } from "./types";

export class NotifyExecutor implements NodeExecutor {
  async execute({ node, nodes, edges, showToast }: ExecutionContext): Promise<void> {
    try {
      let resolvedMessage = "";
      
      const incomingEdges = edges.filter(e => e.target === node.id);
      if (incomingEdges.length > 0) {
        const upstreamNodes = nodes.filter(n => incomingEdges.some(e => e.source === n.id));
        
        for (const upstream of upstreamNodes) {
          if (upstream.type === "ollama" && upstream.data?.lastResponse) {
            resolvedMessage = String(upstream.data.lastResponse);
            break;
          } else if (upstream.type === "output" && upstream.data?.outputContent) {
            resolvedMessage = String(upstream.data.outputContent);
            break;
          } else if (upstream.type === "chat") {
            const messages = (upstream.data?.messages as any[]) || [];
            if (messages.length > 0) {
              const lastMessage = messages[messages.length - 1];
              if (lastMessage?.content) {
                resolvedMessage = String(lastMessage.content);
                break;
              }
            }
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

      const label = String(node.data?.label || "Hive");
      await invoke("send_notification", { title: label, body: finalBody });
    } catch (err) {
      showToast(`Notify error: ${err}`, "error");
    }
  }
}
