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
  /** Open the Save-as-custom modal for this node. Provided by InspectorPanel;
   * undefined when the panel isn't configured to surface the action. */
  onSaveAsCustom?: () => void;
  /** Delete this node (with incident edges + storage/chat cleanup). Provided
   * by InspectorPanel via WorkspaceEditor; undefined when no handler is wired. */
  onDeleteNode?: () => void;
}
