import type { Node, Edge } from "@xyflow/react";

export interface InspectorProps {
  node: Node;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  isRunning?: boolean;
  onRun?: (nodeId: string) => void;
  onChatSend?: (nodeId: string, text: string) => void;
  nodes?: Node[];
  edges?: Edge[];
}
