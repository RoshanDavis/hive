import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { JSONStorageNodeData } from "./types";

export default function JSONStorageNodeComponent({
  data,
  selected,
}: NodeProps & { data: JSONStorageNodeData }) {
  return (
    <div className={`flex items-center gap-3 bg-card border-2 rounded-lg px-4 py-3 min-w-[200px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-all duration-200 text-text-main relative ${selected ? "border-[#38bdf8] shadow-[0_0_0_2px_rgba(56,189,248,0.2)]" : "border-border-card"}`}>
      <div className="text-xl">💾</div>
      <div className="text-sm font-semibold tracking-wide flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{data.label}</div>
      <div className="text-[10px] text-text-muted absolute -bottom-5 left-0 whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px]">
        {data.records && data.records.length > 0 
          ? `${data.records.length} records stored`
          : "Empty storage"}
      </div>
      <Handle
        type="target"
        position={Position.Left}
        className="hive-handle"
      />
    </div>
  );
}
