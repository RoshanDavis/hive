import type { HandleConfig, NodePlugin } from "@/engine/plugin";

export type CustomNodeScope = "global" | "workspace";

/** Fields shared by every custom-node definition, regardless of kind. */
export interface CustomNodeBase {
  /** Stable id; the synthesized registry type is `custom:${id}`. */
  id: string;
  name: string;
  icon: string;
  /**
   * Editorial grouping. The synthesized plugin's color is derived from this
   * (via `getCategoryColor`) so users don't pick a color directly.
   */
  category: NodePlugin["meta"]["category"];
  /** Schema version of this definition file. Start at 1. */
  version: number;
}

/**
 * Tier 1 — a preset: a named, saved configuration of an existing base node type.
 * The synthesized plugin reuses the base plugin's behavior; only meta + merged
 * defaultData differ.
 */
export interface PresetCustomNode extends CustomNodeBase {
  kind: "preset";
  /** Built-in plugin type this preset configures (e.g. "llm", "jsonStorage"). */
  baseType: string;
  /** Partial node.data layered on top of the base plugin's defaultData. */
  presetData: Record<string, unknown>;
}

/** One configSchema entry — renders as a per-instance config input in the inspector. */
export interface ScriptField {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "password";
  required?: boolean;
  default?: unknown;
  /** Choices for `type: "select"`. */
  options?: string[];
}

/**
 * Network capability grant for a script node's `fetch`. `none` blocks all network;
 * `allowlist` permits only hosts matching one of the `allow` globs (Phase B).
 */
export interface NetworkGrant {
  mode: "none" | "allowlist";
  /** Host globs, e.g. "api.github.com", "*.example.com". */
  allow: string[];
}

/** Resource ceilings requested by a definition. Rust clamps these to hard maxima. */
export interface ScriptLimits {
  timeoutMs: number;
  memoryBytes: number;
}

/**
 * Tier 3 — a script node: behavior comes from user-authored code executed in a
 * Rust-side sandbox (rquickjs). The source lives in `<node>/script.js` on disk
 * (the single source of truth) and is never carried through the renderer or
 * `node.json` — only the metadata + capability grants below are persisted here.
 */
export interface ScriptCustomNode extends CustomNodeBase {
  kind: "script";
  /** Only "js" is implemented; "wasm" is reserved (see design doc). */
  runtime: "js" | "wasm";
  /** Source filename within the node folder. Defaults to "script.js". */
  entry: string;
  /** Drives the per-instance inspector form; values are passed to the script as `config`. */
  configSchema: ScriptField[];
  /** Network allowlist for the script's `fetch` (Phase B). */
  network: NetworkGrant;
  /** credentialIds the script may reference for server-side header injection (Phase B). */
  credentials: string[];
  limits: ScriptLimits;
  /** Custom handle layout (Phase C). When omitted, the engine default (in/out) applies. */
  handles?: HandleConfig[];
}

/**
 * Discriminated union of all custom-node kinds: `preset` (Tier 1) and `script`
 * (Tier 3). Discriminate on `kind`.
 */
export type CustomNodeDefinition = PresetCustomNode | ScriptCustomNode;

/** The on-disk registry type prefix used to namespace custom nodes. */
export const CUSTOM_TYPE_PREFIX = "custom:";

export function customTypeFor(id: string): string {
  return `${CUSTOM_TYPE_PREFIX}${id}`;
}

export function isCustomType(type: string | undefined | null): boolean {
  return typeof type === "string" && type.startsWith(CUSTOM_TYPE_PREFIX);
}
