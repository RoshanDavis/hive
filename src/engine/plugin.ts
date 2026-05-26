import type { ComponentType } from "react";
import type { NodeExecutor, NodeOutputEnvelope } from "./types";

export interface HandleConfig {
  id?: string;
  type: "source" | "target";
  position: "top" | "bottom" | "left" | "right";
  style?: Record<string, unknown>;
}

export interface NodePlugin {
  /** Unique node type identifier */
  type: string;

  /** Display metadata */
  meta: {
    label: string;
    icon: string;
    description: string;
    category: "input" | "processing" | "output" | "storage" | "custom";
    color: string;
  };

  /** Default data applied when a new node of this type is created */
  defaultData: Record<string, unknown>;

  /** Custom React component for rendering. If omitted, GenericNodeShell is used. */
  component?: ComponentType<any>;

  /** Inspector panel component shown when the node is selected */
  inspector?: ComponentType<any>;

  /** Executor that runs the node during workflow execution */
  executor?: NodeExecutor;

  /** Handle configuration. Defaults to [target-left, source-right] if omitted. */
  handles?: HandleConfig[];

  /** Custom output extraction from node data */
  getOutput?: (nodeData: Record<string, unknown>) => NodeOutputEnvelope;

  /** Concurrency pool assignment. Defaults to 'general'. */
  concurrencyPool?: string | ((nodeData: Record<string, unknown>) => string);

  /** Whether this node can pause workflow execution (e.g. Chat awaits user input) */
  canPauseWorkflow?: boolean;

  /** If true, engine won't do post-execution storage sync */
  skipStorageSync?: boolean;

  /** Backward-compatible type aliases */
  aliases?: string[];
}
