import { pluginRegistry } from "@/engine/pluginRegistry";
import type { DefaultsEditorProps } from "@/engine/plugin";

interface Props extends DefaultsEditorProps {
  /** Plugin type — used to look up the source defaultData for fallback typing. */
  pluginType: string;
}

/**
 * Fallback editor that auto-generates a labeled input per key in `plugin.defaultData`.
 * Inputs are typed from the source value (string/number/boolean). Object/array fields
 * are read-only displayed as JSON so users at least see them.
 */
export default function AutoDefaultsEditor({ pluginType, values, onUpdate }: Props) {
  const plugin = pluginRegistry.get(pluginType);
  if (!plugin) return null;

  const sourceDefaults = plugin.defaultData;
  const keys = Object.keys(sourceDefaults);

  const updateKey = (k: string, v: unknown) => onUpdate({ ...values, [k]: v });
  const clearKey = (k: string) => {
    const { [k]: _drop, ...rest } = values;
    onUpdate(rest);
  };

  const isOverridden = (k: string) => Object.prototype.hasOwnProperty.call(values, k);

  return (
    <div className="flex flex-col gap-4">
      {keys.map((k) => {
        const sourceValue = sourceDefaults[k];
        const effectiveValue = isOverridden(k) ? values[k] : sourceValue;
        const overridden = isOverridden(k);

        return (
          <div key={k} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {k}
                {overridden && (
                  <span className="ml-2 text-[9px] text-accent tracking-normal normal-case font-normal">
                    overridden
                  </span>
                )}
              </label>
              {overridden && (
                <button
                  type="button"
                  className="text-[10px] text-text-muted hover:text-text-main border-none bg-transparent cursor-pointer underline"
                  onClick={() => clearKey(k)}
                  title="Revert to plugin default"
                >
                  Revert
                </button>
              )}
            </div>
            {renderInput(k, sourceValue, effectiveValue, (v) => updateKey(k, v))}
          </div>
        );
      })}
    </div>
  );
}

function renderInput(
  key: string,
  sourceValue: unknown,
  currentValue: unknown,
  onChange: (v: unknown) => void
) {
  if (typeof sourceValue === "boolean") {
    return (
      <input
        type="checkbox"
        checked={Boolean(currentValue)}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 cursor-pointer"
      />
    );
  }
  if (typeof sourceValue === "number") {
    return (
      <input
        type="number"
        value={Number(currentValue ?? 0)}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main outline-none focus:border-accent-dim"
      />
    );
  }
  if (typeof sourceValue === "string" || sourceValue === undefined || sourceValue === null) {
    // Heuristic: long strings get a textarea
    const isLong = typeof sourceValue === "string" && sourceValue.length > 60;
    if (isLong || key.toLowerCase().includes("prompt")) {
      return (
        <textarea
          rows={3}
          value={String(currentValue ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main outline-none focus:border-accent-dim resize-y min-h-[64px]"
        />
      );
    }
    return (
      <input
        type="text"
        value={String(currentValue ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main outline-none focus:border-accent-dim"
      />
    );
  }
  return (
    <pre className="text-[11px] text-text-muted bg-input border border-border-subtle rounded-md px-3 py-2 overflow-x-auto">
      {JSON.stringify(sourceValue, null, 2)}
    </pre>
  );
}
