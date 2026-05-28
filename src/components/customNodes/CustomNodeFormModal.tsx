import { useMemo, useState } from "react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { useCustomNodes } from "@/contexts/CustomNodesContext";
import AutoDefaultsEditor from "@/components/defaults/AutoDefaultsEditor";
import {
  isCustomType,
  type CustomNodeDefinition,
  type CustomNodeScope,
} from "@/types/customNodes";
import type { NodePlugin } from "@/engine/plugin";

const CATEGORIES: NodePlugin["meta"]["category"][] = [
  "input",
  "processing",
  "output",
  "storage",
  "custom",
];

/** node.data keys that are execution state, not configuration — never snapshot these. */
const RUNTIME_FIELDS = [
  "status",
  "error",
  "lastResponse",
  "outputEnvelope",
  "records",
  "messages",
  "outputContent",
];

export function stripRuntimeFields(
  data: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!RUNTIME_FIELDS.includes(k)) out[k] = v;
  }
  return out;
}

export interface CustomNodeFormInitial {
  /** Set when editing an existing definition (locks baseType + scope). */
  id?: string;
  baseType: string;
  presetData: Record<string, unknown>;
  name?: string;
  icon?: string;
  color?: string;
  category?: NodePlugin["meta"]["category"];
  scope?: CustomNodeScope;
  /** Lock the base-type selector (save-from-node / edit). */
  lockBaseType?: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  showToast: (msg: string, kind: "success" | "error" | "info") => void;
  /** Whether workspace scope is selectable (false on the global Nodes tab). */
  allowWorkspaceScope: boolean;
  /** Pre-fill for save-from-node or edit. Omit for a from-scratch create. */
  initial?: CustomNodeFormInitial;
}

const baseTypeOptions = (): NodePlugin[] =>
  pluginRegistry.getAll().filter((p) => !p.baseType && !isCustomType(p.type));

export default function CustomNodeFormModal({
  isOpen,
  onClose,
  showToast,
  allowWorkspaceScope,
  initial,
}: Props) {
  const { saveCustomNode, deleteCustomNode, promoteToGlobal, workspacePath } = useCustomNodes();

  const editing = Boolean(initial?.id);
  const options = useMemo(baseTypeOptions, []);
  const fallbackBase = options[0]?.type ?? "";

  const [baseType, setBaseType] = useState(initial?.baseType ?? fallbackBase);
  const base = pluginRegistry.get(baseType);

  const [name, setName] = useState(initial?.name ?? base?.meta.label ?? "Custom node");
  const [icon, setIcon] = useState(initial?.icon ?? base?.meta.icon ?? "🧩");
  const [color, setColor] = useState(initial?.color ?? base?.meta.color ?? "#888888");
  const [category, setCategory] = useState<NodePlugin["meta"]["category"]>(
    initial?.category ?? base?.meta.category ?? "custom"
  );
  const [scope, setScope] = useState<CustomNodeScope>(
    initial?.scope ?? (allowWorkspaceScope ? "workspace" : "global")
  );
  const [presetData, setPresetData] = useState<Record<string, unknown>>(
    initial?.presetData ?? {}
  );
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  // When the base type changes in create mode, refresh meta defaults to match.
  const onBaseChange = (next: string) => {
    setBaseType(next);
    const p = pluginRegistry.get(next);
    if (p) {
      setName(p.meta.label);
      setIcon(p.meta.icon);
      setColor(p.meta.color);
      setCategory(p.meta.category);
    }
    setPresetData({});
  };

  const PresetEditor = base?.defaultsEditor;

  const handleSave = async () => {
    if (!base) {
      showToast("Pick a base node type first", "error");
      return;
    }
    if (!name.trim()) {
      showToast("Give the custom node a name", "error");
      return;
    }
    setSaving(true);
    try {
      const id = initial?.id ?? crypto.randomUUID();
      // `label` is owned by the preset name (see synthesizePlugin) — don't store
      // it redundantly in presetData.
      const { label: _label, ...cleanPreset } = presetData;
      const def: CustomNodeDefinition = {
        id,
        kind: "preset",
        name: name.trim(),
        icon: icon.trim() || "🧩",
        color,
        category,
        version: 1,
        baseType,
        presetData: cleanPreset,
      };
      await saveCustomNode(scope, def);
      showToast(editing ? "Custom node updated" : "Custom node created", "success");
      onClose();
    } catch (err) {
      showToast(`Failed to save custom node: ${err}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initial?.id) return;
    setSaving(true);
    try {
      await deleteCustomNode(scope, initial.id);
      showToast("Custom node deleted", "success");
      onClose();
    } catch (err) {
      showToast(`Failed to delete: ${err}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const handlePromote = async () => {
    if (!initial?.id) return;
    setSaving(true);
    try {
      await promoteToGlobal(initial.id);
      showToast("Promoted to global", "success");
      onClose();
    } catch (err) {
      showToast(`Failed to promote: ${err}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const lockBase = initial?.lockBaseType || editing;

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
            <span className="text-2xl" style={{ filter: `drop-shadow(0 0 6px ${color}55)` }}>
              {icon}
            </span>
            <span className="text-sm font-bold text-text-main">
              {editing ? "Edit custom node" : "New custom node"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-main text-xl cursor-pointer border-none bg-transparent w-7 h-7 flex items-center justify-center rounded-md hover:bg-card-hover"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Base type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Base node type
            </label>
            {lockBase ? (
              <div className="text-sm text-text-main bg-input border border-border-subtle rounded-md px-3 py-2">
                {base?.meta.label ?? baseType}
              </div>
            ) : (
              <select
                value={baseType}
                onChange={(e) => onBaseChange(e.target.value)}
                className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main outline-none focus:border-accent-dim"
              >
                {options.map((p) => (
                  <option key={p.type} value={p.type}>
                    {p.meta.icon} {p.meta.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main outline-none focus:border-accent-dim"
            />
          </div>

          {/* Icon + Color + Category */}
          <div className="flex gap-3">
            <div className="flex flex-col gap-1.5 w-20">
              <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Icon
              </label>
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main outline-none focus:border-accent-dim text-center"
              />
            </div>
            <div className="flex flex-col gap-1.5 w-20">
              <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Color
              </label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-full h-[38px] bg-input border border-border-subtle rounded-md cursor-pointer"
              />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Category
              </label>
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as NodePlugin["meta"]["category"])
                }
                className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main outline-none focus:border-accent-dim"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Scope (locked when editing) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Scope
            </label>
            {editing ? (
              <div className="text-sm text-text-secondary bg-input border border-border-subtle rounded-md px-3 py-2">
                {scope === "global" ? "🌐 Global — all workspaces" : "📁 Workspace only"}
              </div>
            ) : (
              <div className="flex gap-2">
                {allowWorkspaceScope && (
                  <button
                    type="button"
                    onClick={() => setScope("workspace")}
                    className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold border cursor-pointer transition-colors ${
                      scope === "workspace"
                        ? "bg-accent/30 border-accent/50 text-text-main"
                        : "bg-card border-border-subtle text-text-muted hover:text-text-main"
                    }`}
                  >
                    📁 Workspace
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setScope("global")}
                  className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold border cursor-pointer transition-colors ${
                    scope === "global"
                      ? "bg-accent/30 border-accent/50 text-text-main"
                      : "bg-card border-border-subtle text-text-muted hover:text-text-main"
                  }`}
                >
                  🌐 Global
                </button>
              </div>
            )}
          </div>

          {/* Preset data editor */}
          {base && (
            <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Configuration
              </span>
              {PresetEditor ? (
                <PresetEditor
                  values={presetData}
                  onUpdate={setPresetData}
                  workspacePath={scope === "workspace" ? workspacePath : null}
                  scope={scope}
                />
              ) : (
                <AutoDefaultsEditor
                  pluginType={baseType}
                  values={presetData}
                  onUpdate={setPresetData}
                  workspacePath={scope === "workspace" ? workspacePath : null}
                  scope={scope}
                  excludeKeys={["label"]}
                />
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle gap-2">
          <div className="flex gap-3">
            {editing && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="text-[11px] text-text-muted hover:text-[#ff6b6b] border-none bg-transparent cursor-pointer underline disabled:opacity-50"
              >
                Delete
              </button>
            )}
            {editing && scope === "workspace" && (
              <button
                type="button"
                onClick={handlePromote}
                disabled={saving}
                className="text-[11px] text-text-muted hover:text-accent border-none bg-transparent cursor-pointer underline disabled:opacity-50"
                title="Move this custom node to global scope (all workspaces)"
              >
                Promote to global 🌐
              </button>
            )}
          </div>
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
              disabled={saving}
              className="bg-accent/30 hover:bg-accent/45 border border-accent/50 hover:border-accent text-text-main rounded-md px-4 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
