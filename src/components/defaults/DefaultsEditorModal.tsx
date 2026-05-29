import { useEffect, useState } from "react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { nodeDefaultsService, type DefaultsScope } from "@/services/nodeDefaultsService";
import AutoDefaultsEditor from "./AutoDefaultsEditor";

interface DefaultsEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  pluginType: string;
  scope: DefaultsScope;
  /** Required when scope === "workspace". */
  workspacePath: string | null;
  showToast: (msg: string, kind: "success" | "error" | "info") => void;
  /** Called after a save succeeds so the caller can refresh any list views. */
  onSaved?: () => void;
}

export default function DefaultsEditorModal({
  isOpen,
  onClose,
  pluginType,
  scope,
  workspacePath,
  showToast,
  onSaved,
}: DefaultsEditorModalProps) {
  const plugin = pluginRegistry.get(pluginType);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !plugin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        nodeDefaultsService.invalidate(workspacePath ?? undefined);
        const cfg =
          scope === "global"
            ? await nodeDefaultsService.loadGlobal()
            : workspacePath
              ? await nodeDefaultsService.loadWorkspace(workspacePath)
              : { defaults: {} as Record<string, Record<string, unknown>> };
        if (cancelled) return;
        const current = (cfg.defaults?.[pluginType] as Record<string, unknown>) ?? {};
        setValues({ ...current });
        setInitialValues({ ...current });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, plugin, pluginType, scope, workspacePath]);

  if (!isOpen || !plugin) return null;

  const dirty = JSON.stringify(values) !== JSON.stringify(initialValues);
  const Editor = plugin.defaultsEditor;

  const handleSave = async () => {
    setSaving(true);
    try {
      if (Object.keys(values).length === 0) {
        await nodeDefaultsService.clearDefaultsForType(scope, pluginType, workspacePath);
      } else {
        await nodeDefaultsService.setDefaultsForType(scope, pluginType, values, workspacePath);
      }
      showToast(
        scope === "global" ? "Global defaults saved" : "Workspace defaults saved",
        "success"
      );
      setInitialValues({ ...values });
      onSaved?.();
      onClose();
    } catch (err) {
      showToast(`Failed to save: ${err}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleResetAll = () => {
    setValues({});
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border-subtle rounded-xl shadow-card-hover w-full max-w-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <span className="text-2xl" style={{ filter: `drop-shadow(0 0 6px ${plugin.meta.color}55)` }}>
              {plugin.meta.icon}
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-text-main">{plugin.meta.label} defaults</span>
              <span className="text-[11px] text-text-muted">
                {scope === "global" ? "🌐 Global — all workspaces" : "📁 Workspace only"}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-main text-xl cursor-pointer border-none bg-transparent w-7 h-7 flex items-center justify-center rounded-md hover:bg-card-hover"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="bg-accent-glow/50 border border-accent-dim/40 rounded-md px-3 py-2 text-[11px] text-text-secondary mb-4">
            Changes apply to <strong>nodes created after this point</strong>. Existing nodes keep
            their current values.
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 rounded-full border-2 border-border-subtle border-t-accent animate-spin" />
            </div>
          ) : Editor ? (
            <Editor
              values={values}
              onUpdate={setValues}
              workspacePath={workspacePath}
              scope={scope}
            />
          ) : (
            <AutoDefaultsEditor
              pluginType={pluginType}
              values={values}
              onUpdate={setValues}
              workspacePath={workspacePath}
              scope={scope}
            />
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle gap-2">
          <button
            type="button"
            onClick={handleResetAll}
            className="text-[11px] text-text-muted hover:text-danger border-none bg-transparent cursor-pointer underline"
            title="Clear all overrides and revert to plugin defaults"
          >
            Reset all to plugin defaults
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="bg-card hover:bg-card-hover border border-border-subtle rounded-md px-3 py-1.5 text-xs text-text-muted hover:text-text-main cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="bg-accent/30 hover:bg-accent/45 border border-accent/50 hover:border-accent text-text-main rounded-md px-4 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
