import { Handle, Position, type NodeProps } from "@xyflow/react";
import StatusBorder from "./StatusBorder";
import { AgentNodeView } from "./AgentNodeView";
import { agentSlotFocus } from "./agentSlotFocus";
import type { AgentNodeData } from "./types";

function statusClassFor(status: string | undefined): string {
  switch (status) {
    case "executing":
      return "node-status-executing";
    case "success":
      return "node-status-success";
    case "waiting":
      return "node-status-waiting";
    case "pending":
      return "node-status-pending";
    case "error":
      return "node-status-error";
    default:
      return "";
  }
}

/**
 * Custom React-Flow component for the Agent container node. Renders the shared
 * AgentNodeView card and supplies the input(left)/output(right) handles and the
 * animated status overlay. The inner LLM/Storage/Tools are slots in node.data,
 * not separate nodes (see docs/agent-node.md).
 */
export default function AgentNode({ id, data, selected }: NodeProps) {
  const status = data.status as string | undefined;
  const statusClass = selected ? "" : statusClassFor(status);

  return (
    <AgentNodeView
      data={data as AgentNodeData}
      selected={!!selected}
      statusClass={statusClass}
      agentId={id}
      onSlotClick={(slot) => agentSlotFocus.request(id, slot)}
    >
      <StatusBorder status={status} selected={selected} />
      <Handle type="target" position={Position.Left} className="hive-handle" />
      <Handle type="source" position={Position.Right} className="hive-handle" />
    </AgentNodeView>
  );
}
