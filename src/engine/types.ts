import type { Node, Edge } from "@xyflow/react";

export interface ExecutionContext {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
}

export interface NodeExecutor {
  execute(context: ExecutionContext): Promise<void>;
}
