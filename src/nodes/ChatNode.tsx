import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ChatNodeData } from "./types";

export default function ChatNodeComponent({
  data,
  selected,
}: NodeProps & { data: ChatNodeData }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1.5 bg-card border-2 rounded-lg px-3 py-2.5 min-w-[90px] max-w-[150px] shadow-card transition-all duration-200 text-text-main relative ${selected ? "border-node-chat shadow-[0_0_0_2px_rgba(52,211,153,0.2)]" : "border-border-card"}`}>
      <Handle
        type="target"
        position={Position.Left}
        className="hive-handle"
      />
      <div className="text-2xl">💬</div>
      <div className="text-xs font-semibold tracking-wide text-center w-full whitespace-nowrap overflow-hidden text-ellipsis">{data.label}</div>
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
