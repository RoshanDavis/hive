import { pluginRegistry } from "@/engine/pluginRegistry";
import type { NodePlugin } from "@/engine/plugin";
import {
  customTypeFor,
  type CustomNodeDefinition,
} from "@/types/customNodes";

/**
 * Turn a stored custom-node definition into a runnable `NodePlugin`.
 *
 * Tier 1 (preset): the synthesized plugin reuses the base plugin's behavior
 * verbatim (executor / inspector / component / handles / getOutput /
 * concurrencyPool / canPauseWorkflow / skipStorageSync / credentialSchemas);
 * only `meta` and the merged `defaultData` come from the definition. Returns
 * `null` when the base plugin is unknown (the loader registers a placeholder
 * instead — see `makeUnknownCustomPlugin`).
 */
export function synthesizePlugin(def: CustomNodeDefinition): NodePlugin | null {
  if (def.kind !== "preset") return null;
  const base = pluginRegistry.get(def.baseType);
  if (!base) return null;

  return {
    type: customTypeFor(def.id),
    baseType: def.baseType,
    meta: {
      label: def.name,
      icon: def.icon,
      color: def.color,
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
