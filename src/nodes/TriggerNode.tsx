import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TriggerNodeData } from "./types";

export default function TriggerNodeComponent({
  data,
  selected,
}: NodeProps & { data: TriggerNodeData }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1.5 bg-card border-2 rounded-lg px-3 py-2.5 min-w-[90px] max-w-[150px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-all duration-200 text-text-main relative ${selected ? "border-[#d4e600] shadow-[0_0_0_2px_rgba(212,230,0,0.2)]" : "border-border-card"}`}>
      <div className="text-2xl">⚡</div>
      <div className="text-xs font-semibold tracking-wide text-center w-full whitespace-nowrap overflow-hidden text-ellipsis">{data.label}</div>
      <Handle
        type="source"
        position={Position.Right}
        className="hive-handle"
      />
    </div>
  );
}
