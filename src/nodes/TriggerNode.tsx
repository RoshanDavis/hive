import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TriggerNodeData } from "./types";

export default function TriggerNodeComponent({
  data,
  selected,
}: NodeProps & { data: TriggerNodeData }) {
  return (
    <div className={`flex items-center gap-3 bg-card border-2 rounded-lg px-4 py-3 min-w-[200px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-all duration-200 text-text-main ${selected ? "border-[#d4e600] shadow-[0_0_0_2px_rgba(212,230,0,0.2)]" : "border-border-card"}`}>
      <div className="text-xl">⚡</div>
      <div className="text-sm font-semibold tracking-wide flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{data.label}</div>
      <Handle
        type="source"
        position={Position.Right}
        className="hive-handle"
      />
    </div>
  );
}
