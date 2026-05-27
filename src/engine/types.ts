import type { Node, Edge } from "@xyflow/react";

export interface ExecutionContext {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
  chatInput?: string;
  executeNode?: (nodeType: string, context: ExecutionContext) => Promise<void>;
  visited?: Set<string>;
  /** The workspace this execution belongs to. Needed for resolving local-scope credentials. */
  workspacePath: string;
}

export interface NodeExecutor {
  execute(context: ExecutionContext): Promise<void>;
}

export interface NodeOutputEnvelope {
  /** The primary default string output. Text-only nodes consume this directly. */
  value: string;
  
  /** Technical metrics, status codes, token usage, execution timestamps */
  metadata?: Record<string, any>;
  
  /** Custom rich data structure (e.g., full database rows, parsed HTTP JSON response objects) */
  data?: any;
}
