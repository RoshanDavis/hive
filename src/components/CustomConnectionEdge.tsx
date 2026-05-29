import { EdgeProps, getBezierPath } from "@xyflow/react";

export default function CustomConnectionEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
  selected,
}: EdgeProps) {
  // Centerline path calculation
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
  });

  const edgeType = (data?.edgeType as string) || "one-way";

  const isDatabase = ["read-only", "write-only", "read-write"].includes(edgeType);
  const strokeColor = isDatabase ? "#38bdf8" : "#d4e600";
  const glowShadow = isDatabase 
    ? (selected ? "drop-shadow(0 0 4px rgba(56, 189, 248, 0.65))" : undefined)
    : (selected ? "drop-shadow(0 0 4px rgba(212, 230, 0, 0.6))" : undefined);

  let isReverse = false;
  if (edgeType === "read-only") {
    if (target?.startsWith("jsonStorage")) {
      isReverse = true;
    }
  } else if (edgeType === "write-only") {
    if (source?.startsWith("jsonStorage")) {
      isReverse = true;
    }
  }

  if (edgeType === "bi-directional" || edgeType === "read-write") {
    // ─── Parallel track calculations for bi-directional flows ───
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    
    // Perpendicular normal vector
    const nx = -dy / len;
    const ny = dx / len;
    
    // Offset amount in pixels for parallel dashed lines
    const offset = 2.5;

    // Left track (Forward animated dashed flow)
    const [forwardPath] = getBezierPath({
      sourceX: sourceX + nx * offset,
      sourceY: sourceY + ny * offset,
      sourcePosition,
      targetPosition,
      targetX: targetX + nx * offset,
      targetY: targetY + ny * offset,
    });

    // Right track (Backward animated dashed flow)
    const [backwardPath] = getBezierPath({
      sourceX: sourceX - nx * offset,
      sourceY: sourceY - ny * offset,
      sourcePosition,
      targetPosition,
      targetX: targetX - nx * offset,
      targetY: targetY - ny * offset,
    });

    return (
      <>
        {/* 1. Transparent interaction path (provides a wide, comfortable clicking area) */}
        <path
          id={id}
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={20}
          className="react-flow__edge-interaction cursor-pointer"
          style={{ pointerEvents: "auto" }}
        />

        {/* 2. Left Track: Forward flow */}
        <path
          style={{
            ...style,
            stroke: strokeColor,
            strokeWidth: selected ? 2.5 : 1.8,
            fill: "none",
            pointerEvents: "none",
            filter: glowShadow || undefined
          }}
          className="react-flow__edge-path animated-edge-forward"
          d={forwardPath}
        />

        {/* 3. Right Track: Backward flow */}
        <path
          style={{
            ...style,
            stroke: strokeColor,
            strokeWidth: selected ? 2.5 : 1.8,
            fill: "none",
            pointerEvents: "none"
          }}
          className="animated-edge-backward"
          d={backwardPath}
        />
      </>
    );
  }

  // ─── Standard One-way / Read-Only / Write-Only flow ───
  return (
    <>
      {/* 1. Transparent interaction path (provides a wide, comfortable clicking area) */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="react-flow__edge-interaction cursor-pointer"
        style={{ pointerEvents: "auto" }}
      />

      {/* 2. Standard animated forward/reversed flow path (no markers/arrowheads) */}
      <path
        style={{ 
          ...style, 
          stroke: strokeColor, 
          strokeWidth: selected ? 3 : 2, 
          fill: "none", 
          pointerEvents: "none",
          filter: glowShadow || undefined
        }}
        className={`react-flow__edge-path ${isReverse ? "animated-edge-backward" : "animated-edge-forward"}`}
        d={edgePath}
      />
    </>
  );
}
