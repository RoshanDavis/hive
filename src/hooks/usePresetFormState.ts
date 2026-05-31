import { useState, type Dispatch, type SetStateAction } from "react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import type { NodePlugin } from "@/engine/plugin";
import type { CustomNodeDefinition } from "@/types/customNodes";

interface UsePresetFormStateArgs {
  initialBaseType?: string;
  initialPresetData?: Record<string, unknown>;
  fallbackBase: string;
}

export interface PresetFormState {
  baseType: string;
  setBaseType: Dispatch<SetStateAction<string>>;
  presetData: Record<string, unknown>;
  setPresetData: Dispatch<SetStateAction<Record<string, unknown>>>;
  /** The resolved base plugin (or undefined if `baseType` is empty / unregistered). */
  base: NodePlugin | undefined;
  /** Reset preset data and bump the chosen base type. */
  onBaseChange: (next: string) => { name?: string; icon?: string };
  /** Returns a validation error message, or null when ready to save. */
  validate: () => string | null;
  /** Build the on-disk definition. Caller supplies the common meta fields. */
  buildDef(args: {
    id: string;
    name: string;
    icon: string;
    category: NodePlugin["meta"]["category"];
  }): CustomNodeDefinition;
}

/**
 * Owns the state + save shape for the "preset" branch of `CustomNodeFormModal`.
 * Keeps preset concerns out of the shell so adding/removing preset-specific
 * fields doesn't touch the script branch.
 */
export function usePresetFormState({
  initialBaseType,
  initialPresetData,
  fallbackBase,
}: UsePresetFormStateArgs): PresetFormState {
  const [baseType, setBaseType] = useState(initialBaseType ?? fallbackBase);
  const [presetData, setPresetData] = useState<Record<string, unknown>>(
    initialPresetData ?? {}
  );
  const base = pluginRegistry.get(baseType);

  const onBaseChange = (next: string): { name?: string; icon?: string } => {
    setBaseType(next);
    setPresetData({});
    const p = pluginRegistry.get(next);
    return p ? { name: p.meta.label, icon: p.meta.icon } : {};
  };

  const validate = (): string | null => {
    if (!base) return "Pick a base node type first";
    return null;
  };

  const buildDef: PresetFormState["buildDef"] = ({ id, name, icon, category }) => {
    // `label` is owned by the preset name (see synthesizePlugin) — don't
    // store it redundantly in presetData.
    const { label: _label, ...cleanPreset } = presetData;
    return {
      id,
      kind: "preset",
      name: name.trim(),
      icon: icon.trim() || "🧩",
      category,
      version: 1,
      baseType,
      presetData: cleanPreset,
    };
  };

  return {
    baseType,
    setBaseType,
    presetData,
    setPresetData,
    base,
    onBaseChange,
    validate,
    buildDef,
  };
}
