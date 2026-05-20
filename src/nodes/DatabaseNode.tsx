import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { DatabaseNodeData } from "./types";

export default function DatabaseNodeComponent({
  data,
  selected,
}: NodeProps & { data: DatabaseNodeData }) {
  return (
    <div className={`flex items-center gap-3 bg-card border-2 rounded-lg px-4 py-3 min-w-[200px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-all duration-200 text-text-main relative ${selected ? "border-[#60a5fa] shadow-[0_0_0_2px_rgba(96,165,250,0.2)]" : "border-border-card"}`}>
      <div className="text-xl">🛢️</div>
      <div className="text-sm font-semibold tracking-wide flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{data.label}</div>
      <div className="text-[10px] text-text-muted absolute -bottom-5 left-0 whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px]">
        {data.records && data.records.length > 0 
          ? `${data.records.length} records stored`
          : "Empty database"}
      </div>
      <Handle
        type="target"
        position={Position.Left}
        className="hive-handle"
      />
    </div>
  );
}
