import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { OllamaNodeData } from "./types";
import StatusBorder from "./StatusBorder";

export default function OllamaNodeComponent({
  data,
  selected,
}: NodeProps & { data: OllamaNodeData }) {
  const statusClass =
    selected
      ? "" // Selection white border takes precedence
      : data.status === "executing"
      ? "node-status-executing"
      : data.status === "success"
      ? "node-status-success"
      : data.status === "waiting"
      ? "node-status-waiting"
      : data.status === "pending"
      ? "node-status-pending"
      : data.status === "error"
      ? "node-status-error"
      : "";

  return (
    <div className={`flex flex-col items-center justify-center gap-1.5 bg-card border-2 rounded-lg px-3 py-2.5 min-w-[90px] max-w-[150px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-all duration-500 text-text-main relative ${selected ? "border-white shadow-[0_0_12px_rgba(255,255,255,0.15)]" : "border-border-card"} ${statusClass}`}>
      <StatusBorder status={data.status as string | undefined} selected={selected} />
      <Handle
        type="target"
        position={Position.Left}
        className="hive-handle"
      />
      <div className="text-2xl">🤖</div>
      <div className="text-xs font-semibold tracking-wide text-center w-full whitespace-nowrap overflow-hidden text-ellipsis">{data.label}</div>
      <Handle
        type="source"
        position={Position.Right}
        className="hive-handle"
      />
    </div>
  );
}
