import type { Node, Edge } from "@xyflow/react";

export interface InspectorProps {
  node: Node;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  isRunning?: boolean;
  runningStartNodeIds?: Map<string, number>;
  onRun?: (nodeId: string) => void;
  onCancel?: (nodeId?: string) => void;
  onChatSend?: (nodeId: string, text: string) => void;
  nodes?: Node[];
  edges?: Edge[];
  workspacePath: string;
}
