import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { OllamaNodeData } from "./types";

export default function OllamaNodeComponent({
  data,
  selected,
}: NodeProps & { data: OllamaNodeData }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1.5 bg-card border-2 rounded-lg px-3 py-2.5 min-w-[90px] max-w-[150px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-all duration-200 text-text-main relative ${selected ? "border-[#a78bfa] shadow-[0_0_0_2px_rgba(167,139,250,0.2)]" : "border-border-card"}`}>
      <Handle
        type="target"
        position={Position.Left}
        className="hive-handle"
      />
      <div className="text-2xl">🤖</div>
      <div className="text-xs font-semibold tracking-wide text-center w-full whitespace-nowrap overflow-hidden text-ellipsis">{data.label}</div>
      <div className="text-[9px] text-text-muted absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]">{data.model || "llama3"}</div>
      <Handle
        type="source"
        position={Position.Right}
        className="hive-handle"
      />
    </div>
  );
}
