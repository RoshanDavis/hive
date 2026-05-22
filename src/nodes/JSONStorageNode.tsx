import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { JSONStorageNodeData } from "./types";

export default function JSONStorageNodeComponent({
  data,
  selected,
}: NodeProps & { data: JSONStorageNodeData }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1.5 bg-card border-2 rounded-lg px-3 py-2.5 min-w-[90px] max-w-[150px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-all duration-200 text-text-main relative ${selected ? "border-[#38bdf8] shadow-[0_0_0_2px_rgba(56,189,248,0.2)]" : "border-border-card"}`}>
      <div className="text-2xl">💾</div>
      <div className="text-xs font-semibold tracking-wide text-center w-full whitespace-nowrap overflow-hidden text-ellipsis">{data.label}</div>
      <div className="text-[9px] text-text-muted absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]">
        {data.records && data.records.length > 0 
          ? `${data.records.length} records stored`
          : "Empty storage"}
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="hive-handle"
        style={{ backgroundColor: "#38bdf8" }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="right"
        className="hive-handle"
        style={{ backgroundColor: "#38bdf8" }}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="hive-handle"
        style={{ backgroundColor: "#38bdf8" }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom"
        className="hive-handle"
        style={{ backgroundColor: "#38bdf8" }}
      />
    </div>
  );
}
