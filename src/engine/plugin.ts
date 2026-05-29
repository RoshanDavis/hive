import type { ComponentType } from "react";
import type { NodeExecutor, NodeOutputEnvelope } from "./types";
import type { CredentialSchema } from "@/types/credentialTypes";

export interface HandleConfig {
  id?: string;
  type: "source" | "target";
  position: "top" | "bottom" | "left" | "right";
  style?: Record<string, unknown>;
}

/** Props passed to a plugin's defaults editor (rendered in the Nodes tab and SettingsModal). */
export interface DefaultsEditorProps {
  /** Current saved override values for this plugin (after merging plugin.defaultData). */
  values: Record<string, unknown>;
  /** Called on every field change. The values are the full override blob to persist. */
  onUpdate: (next: Record<string, unknown>) => void;
  /** Null on the landing-page Nodes tab (global scope); set inside a workspace. */
  workspacePath: string | null;
  /** Tells the editor whether it's editing global or workspace defaults. */
  scope: "global" | "workspace";
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

  /**
   * Optional lightweight editor for setting plugin defaults at global/workspace scope.
   * Distinct from `inspector`: no Run/chat/credential UI. If omitted, AutoDefaultsEditor
   * generates a field-by-field editor from `defaultData` keys.
   */
  defaultsEditor?: ComponentType<DefaultsEditorProps>;

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

  /** Credential shapes this node type can consume. The picker filters by these. */
  credentialSchemas?: CredentialSchema[];

  /**
   * For synthesized custom-node plugins (`custom:<id>`): the built-in type whose
   * behavior this node derives from. Connectivity rules resolve through this so a
   * preset over e.g. `llm` keeps the base type's edge behavior.
   */
  baseType?: string;
}
