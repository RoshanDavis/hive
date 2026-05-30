import { type ContextMenuItem } from "@/components/ContextMenu";

/** Per-space coarse status rollup persisted in `.hive/config.json`. Backs
 * the Dashboard dot so we can derive workspace health without loading
 * every space's nodes. `error` always wins over `waiting`; `executing` is
 * intentionally never persisted. */
export type SpaceRollup = "error" | "waiting";

export interface SpaceEntry {
  id: string;
  label: string;
  order: number;
  status?: SpaceRollup;
}

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  source_handle?: string;
  target_handle?: string;
  edge_type?: string;
}

export interface SpaceData {
  id: string;
  label: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: { x: number; y: number; zoom: number };
}

export interface WorkspaceConfig {
  version: number;
  name: string;
  created_at: string;
  updated_at: string;
  spaces: SpaceEntry[];
  active_space: string;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

export interface HiveEdgeData extends Record<string, unknown> {
  edgeType: string;
}

export type ShowToastFunc = (message: string, type: "success" | "error" | "info") => void;
