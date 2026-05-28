import type { NodePlugin } from "@/engine/plugin";

export type CustomNodeScope = "global" | "workspace";

/** Fields shared by every custom-node definition, regardless of kind. */
export interface CustomNodeBase {
  /** Stable id; the synthesized registry type is `custom:${id}`. */
  id: string;
  name: string;
  icon: string;
  color: string;
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

/**
 * Discriminated union of all custom-node kinds. Phase 1 ships `preset` only;
 * a `script` variant (Tier 3) extends this union later.
 */
export type CustomNodeDefinition = PresetCustomNode;

/** The on-disk registry type prefix used to namespace custom nodes. */
export const CUSTOM_TYPE_PREFIX = "custom:";

export function customTypeFor(id: string): string {
  return `${CUSTOM_TYPE_PREFIX}${id}`;
}

export function isCustomType(type: string | undefined | null): boolean {
  return typeof type === "string" && type.startsWith(CUSTOM_TYPE_PREFIX);
}
