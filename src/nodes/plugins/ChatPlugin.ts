import type { NodePlugin } from "@/engine/plugin";
import type { NodeOutputEnvelope } from "@/engine/types";
import { ChatExecutor } from "@/engine/ChatExecutor";
import { ChatInspector } from "@/components/inspectors";
import { NODE_COLORS, DATABASE } from "@/theme/colors";
import { getChatMessages } from "@/engine/nodeData";

const ChatPlugin: NodePlugin = {
  type: "chat",
  meta: {
    label: "Chat",
    icon: "💬",
    description: "Provides chat input to an agent",
    category: "input",
    color: NODE_COLORS.chat,
  },
  defaultData: { label: "Chat", messages: [] },
  inspector: ChatInspector,
  executor: new ChatExecutor(),
  handles: [
    { type: "target", position: "left" },
    { type: "source", position: "right" },
    { type: "source", position: "bottom", id: "storage", style: { bottom: -2, backgroundColor: DATABASE } },
  ],
  canPauseWorkflow: true,
  skipStorageSync: true,
  getOutput: (nodeData): NodeOutputEnvelope => {
    // Prefer the structured envelope written by ChatExecutor.
    if (nodeData.outputEnvelope) {
      return nodeData.outputEnvelope as NodeOutputEnvelope;
    }
    // Cold-start (Chat re-opened, never executed this session): derive from
    // the persisted message history so downstream nodes still see something.
    const messages = getChatMessages(nodeData);
    if (messages.length > 0) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
      if (lastUserMsg?.content !== undefined && lastUserMsg?.content !== null) {
        return { value: String(lastUserMsg.content) };
      }
    }
    return { value: "" };
  },
};

export default ChatPlugin;
