import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ChatNodeData } from "./types";

export default function ChatNodeComponent({
  data,
  selected,
}: NodeProps & { data: ChatNodeData }) {
  return (
    <div className={`flex items-center gap-3 bg-card border-2 rounded-lg px-4 py-3 min-w-50 shadow-card transition-all duration-200 text-text-main relative ${selected ? "border-node-chat shadow-[0_0_0_2px_rgba(52,211,153,0.2)]" : "border-border-card"}`}>
      <div className="text-xl">💬</div>
      <div className="text-sm font-semibold tracking-wide flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{data.label}</div>
      <div className="text-[10px] text-text-muted absolute -bottom-5 left-0 whitespace-nowrap overflow-hidden text-ellipsis max-w-50">
        {data.messages && data.messages.length > 0 
          ? (() => {
              const lastMsg = data.messages[data.messages.length - 1].content;
              return lastMsg.substring(0, 20) + (lastMsg.length > 20 ? "..." : "");
            })()
          : "Empty chat"}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="hive-handle"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="storage"
        className="hive-handle"
        style={{ bottom: -2, backgroundColor: "#38bdf8" }}
      />
    </div>
  );
}
