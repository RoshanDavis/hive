interface StatusBorderProps {
  status?: string;
  selected?: boolean;
}

export default function StatusBorder({ status, selected }: StatusBorderProps) {
  if (selected) {
    return null;
  }
  if (status !== "executing" && status !== "waiting" && status !== "pending" && status !== "error") {
    return null;
  }

  const className =
    status === "executing"
      ? "status-border-executing"
      : status === "waiting"
      ? "status-border-waiting"
      : status === "pending"
      ? "status-border-pending"
      : "status-border-error";

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none z-50"
      style={{ overflow: "visible" }}
    >
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        rx="8"
        ry="8"
        fill="none"
        strokeWidth="2"
        className={className}
      />
    </svg>
  );
}

