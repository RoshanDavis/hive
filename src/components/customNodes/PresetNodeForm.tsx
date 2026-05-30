import AutoDefaultsEditor from "@/components/defaults/AutoDefaultsEditor";
import { formInputClass, formLabelClass } from "@/components/shared/FormField";
import type { NodePlugin } from "@/engine/plugin";
import type { CustomNodeScope } from "@/types/customNodes";

/**
 * Preset branch of CustomNodeFormModal. The preset UI is split across two
 * non-adjacent positions in the modal (base-type appears near the top, the
 * configuration editor below the Scope picker), so this module exports two
 * sections rather than a single form. Both are purely presentational — all
 * state lives in the parent modal.
 */

interface PresetBaseTypeSectionProps {
  options: NodePlugin[];
  baseType: string;
  onBaseChange: (next: string) => void;
  /** When true (editing / save-from-node), the selector is read-only. */
  lockBase: boolean;
  /** Resolved plugin for the current baseType, if any. */
  base: NodePlugin | undefined;
}

export function PresetBaseTypeSection({
  options,
  baseType,
  onBaseChange,
  lockBase,
  base,
}: PresetBaseTypeSectionProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={formLabelClass}>Base node type</label>
      {lockBase ? (
        <div className="text-sm text-text-main bg-input border border-border-subtle rounded-md px-3 py-2">
          {base?.meta.label ?? baseType}
        </div>
      ) : (
        <select
          value={baseType}
          onChange={(e) => onBaseChange(e.target.value)}
          className={`${formInputClass} cursor-pointer`}
        >
          {options.map((p) => (
            <option key={p.type} value={p.type}>
              {p.meta.icon} {p.meta.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

interface PresetConfigSectionProps {
  /** Required — the configuration editor only renders when a base is resolved. */
  base: NodePlugin;
  baseType: string;
  presetData: Record<string, unknown>;
  setPresetData: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  workspacePath: string | null;
  scope: CustomNodeScope;
}

export function PresetConfigSection({
  base,
  baseType,
  presetData,
  setPresetData,
  workspacePath,
  scope,
}: PresetConfigSectionProps) {
  const PresetEditor = base.defaultsEditor;

  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
      <span className={formLabelClass}>Configuration</span>
      {PresetEditor ? (
        <PresetEditor
          values={presetData}
          onUpdate={setPresetData}
          workspacePath={workspacePath}
          scope={scope}
        />
      ) : (
        <AutoDefaultsEditor
          pluginType={baseType}
          values={presetData}
          onUpdate={setPresetData}
          workspacePath={workspacePath}
          scope={scope}
          excludeKeys={["label"]}
        />
      )}
    </div>
  );
}
