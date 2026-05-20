import { invoke } from "@tauri-apps/api/core";
import type { ExecutionContext, NodeExecutor } from "./types";

export class NotifyExecutor implements NodeExecutor {
  async execute({ node, showToast }: ExecutionContext): Promise<void> {
    try {
      const message = String(node.data?.message || "Notification from Hive");
      const label = String(node.data?.label || "Hive");
      await invoke("send_notification", { title: label, body: message });
    } catch (err) {
      showToast(`Notify error: ${err}`, "error");
    }
  }
}
