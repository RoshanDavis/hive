import { Handle, Position, type NodeProps } from "@xyflow/react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import StatusBorder from "./StatusBorder";

const positionMap: Record<string, Position> = {
  top: Position.Top,
  bottom: Position.Bottom,
  left: Position.Left,
  right: Position.Right,
};

export default function GenericNodeShell({ type, data, selected }: NodeProps) {
  const plugin = pluginRegistry.get(type);
  const icon = plugin?.meta.icon ?? "📦";

  const statusClass = selected
    ? ""
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

  const handleConfigs = plugin?.handles ?? [
    { type: "target" as const, position: "left" as const },
    { type: "source" as const, position: "right" as const },
  ];

  const handles = handleConfigs.map((h, i) => (
    <Handle
      key={h.id ?? `${h.type}-${h.position}-${i}`}
      id={h.id}
      type={h.type}
      position={positionMap[h.position]}
      className="hive-handle"
      style={h.style as React.CSSProperties | undefined}
    />
  ));

  return (
    <div
      className={`flex flex-col items-center justify-center gap-1.5 bg-card border-2 rounded-lg px-3 py-2.5 min-w-[90px] max-w-[150px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-all duration-500 text-text-main relative ${selected ? "border-white shadow-[0_0_12px_rgba(255,255,255,0.15)]" : "border-border-card"} ${statusClass}`}
    >
      <StatusBorder status={data.status as string | undefined} selected={selected} />
      {handles}
      <div className="text-2xl">{icon}</div>
      <div className="text-xs font-semibold tracking-wide text-center w-full whitespace-nowrap overflow-hidden text-ellipsis">
        {data.label as string}
      </div>
    </div>
  );
}
