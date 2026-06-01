import { pluginRegistry } from "@/engine/pluginRegistry";
import { ScriptExecutor } from "@/engine/ScriptExecutor";
import type { NodePlugin } from "@/engine/plugin";
import ScriptNodeInspector from "@/components/inspectors/ScriptNodeInspector";
import {
  customTypeFor,
  type CustomNodeDefinition,
  type CustomNodeScope,
  type ScriptCustomNode,
  type ScriptField,
} from "@/types/customNodes";

/** Seed node.data from a script's configSchema defaults. */
function defaultsFromConfigSchema(fields: ScriptField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.default !== undefined) out[f.key] = f.default;
  }
  return out;
}

function synthesizeScript(def: ScriptCustomNode, scope: CustomNodeScope): NodePlugin {
  return {
    type: customTypeFor(def.id),
    meta: {
      label: def.name,
      icon: def.icon,
      category: def.category,
      description: "Custom script node",
    },
    defaultData: {
      ...defaultsFromConfigSchema(def.configSchema),
      label: def.name,
    },
    inspector: ScriptNodeInspector,
    executor: new ScriptExecutor(def.id, scope, def.configSchema),
    // Custom handles (Phase C). Undefined → engine default (target-left, source-right).
    handles: def.handles,
    concurrencyPool: "general",
  };
}

/**
 * Turn a stored custom-node definition into a runnable `NodePlugin`.
 *
 * - Preset (Tier 1): reuses the base plugin's behavior verbatim (executor /
 *   inspector / component / handles / getOutput / concurrencyPool /
 *   canPauseWorkflow / skipStorageSync / credentialSchemas); only `meta` and the
 *   merged `defaultData` come from the definition. Returns `null` when the base
 *   plugin is unknown (the loader registers a placeholder instead — see
 *   `makeUnknownCustomPlugin`).
 * - Script (Tier 3): a generic plugin backed by the shared `ScriptExecutor`,
 *   which runs the on-disk source in the Rust sandbox. `scope` is captured so the
 *   executor can locate the node's folder at run time.
 */
export function synthesizePlugin(
  def: CustomNodeDefinition,
  scope: CustomNodeScope
): NodePlugin | null {
  if (def.kind === "script") {
    if (def.runtime !== "js") return null;
    return synthesizeScript(def, scope);
  }

  // Preset
  const base = pluginRegistry.get(def.baseType);
  if (!base) return null;

  return {
    type: customTypeFor(def.id),
    baseType: def.baseType,
    meta: {
      label: def.name,
      icon: def.icon,
      category: def.category,
      description: `Custom ${base.meta.label} preset`,
    },
    // The preset name is the single source of truth for the node's label, so a
    // new instance's canvas label defaults to it (users can still rename per-node).
    defaultData: { ...base.defaultData, ...def.presetData, label: def.name },
    component: base.component,
    inspector: base.inspector,
    defaultsEditor: base.defaultsEditor,
    executor: base.executor,
    handles: base.handles,
    getOutput: base.getOutput,
    concurrencyPool: base.concurrencyPool,
    canPauseWorkflow: base.canPauseWorkflow,
    skipStorageSync: base.skipStorageSync,
    credentialSchemas: base.credentialSchemas,
  };
}
