import type { NodePlugin } from "@/engine/plugin";
import type { NodeOutputEnvelope } from "@/engine/types";
import { ChatExecutor } from "@/engine/ChatExecutor";
import { ChatInspector } from "@/components/inspectors";

const ChatPlugin: NodePlugin = {
  type: "chat",
  meta: {
    label: "Chat",
    icon: "💬",
    description: "Provides chat input to an agent",
    category: "input",
    color: "#34d399",
  },
  defaultData: { label: "Chat", messages: [] },
  inspector: ChatInspector,
  executor: new ChatExecutor(),
  handles: [
    { type: "target", position: "left" },
    { type: "source", position: "right" },
    { type: "source", position: "bottom", id: "storage", style: { bottom: -2, backgroundColor: "#38bdf8" } },
  ],
  canPauseWorkflow: true,
  skipStorageSync: true,
  getOutput: (nodeData): NodeOutputEnvelope => {
    // Prefer structured envelope if available
    if (nodeData.outputEnvelope) {
      return nodeData.outputEnvelope as NodeOutputEnvelope;
    }
    // Fallback: extract last user message from chat history
    if (Array.isArray(nodeData.messages) && nodeData.messages.length > 0) {
      const lastUserMsg = [...(nodeData.messages as any[])]
        .reverse()
        .find((m: any) => m.role === "user");
      if (lastUserMsg?.content !== undefined && lastUserMsg?.content !== null) {
        return { value: String(lastUserMsg.content) };
      }
    }
    if (nodeData.lastResponse !== undefined && nodeData.lastResponse !== null) {
      return { value: String(nodeData.lastResponse) };
    }
    return { value: "" };
  },
};

export default ChatPlugin;
