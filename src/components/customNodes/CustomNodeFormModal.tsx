import { useMemo, useState } from "react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { useCustomNodes } from "@/contexts/CustomNodesContext";
import {
  PresetBaseTypeSection,
  PresetConfigSection,
} from "@/components/customNodes/PresetNodeForm";
import ScriptNodeForm from "@/components/customNodes/ScriptNodeForm";
import { formInputClass, formLabelClass } from "@/components/shared/FormField";
import { useTheme } from "@/contexts/ThemeContext";
import {
  isCustomType,
  type CustomNodeScope,
  type NetworkGrant,
  type ScriptField,
  type ScriptLimits,
} from "@/types/customNodes";
import type { HandleConfig, NodePlugin } from "@/engine/plugin";
import { usePresetFormState } from "@/hooks/usePresetFormState";
import { useScriptFormState } from "@/hooks/useScriptFormState";

type CustomNodeKind = "preset" | "script";

/** node.data keys that are execution state, not configuration — never snapshot these.
 *  `lastResponse` and `outputContent` are legacy run-state fields removed in the
 *  May 2026 Phase 2 refactor; they stay here defensively so old persisted node data
 *  doesn't bleed into preset snapshots. */
const RUNTIME_FIELDS = [
  "status",
  "error",
  "outputEnvelope",
  "records",
  "messages",
  "lastResponse",
  "outputContent",
  "logs",
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
  /** Set when editing an existing definition (locks kind/baseType + scope). */
  id?: string;
  /** Which kind is being authored. Defaults to "preset". */
  kind?: CustomNodeKind;
  /** Preset fields (kind === "preset"). */
  baseType?: string;
  presetData?: Record<string, unknown>;
  /** Script fields (kind === "script"). */
  runtime?: "js" | "wasm";
  entry?: string;
  configSchema?: ScriptField[];
  network?: NetworkGrant;
  credentials?: string[];
  limits?: ScriptLimits;
  handles?: HandleConfig[];
  name?: string;
  icon?: string;
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
  const { saveCustomNode, deleteCustomNode, promoteToGlobal, workspacePath } =
    useCustomNodes();

  const editing = Boolean(initial?.id);
  const options = useMemo(baseTypeOptions, []);
  const fallbackBase = options[0]?.type ?? "";

  // ─── Common meta (shared across both kinds) ──────────────────
  const [kind, setKind] = useState<CustomNodeKind>(initial?.kind ?? "preset");
  const [scope, setScope] = useState<CustomNodeScope>(
    initial?.scope ?? (allowWorkspaceScope ? "workspace" : "global")
  );
  const [saving, setSaving] = useState(false);

  // ─── Kind-specific state, each in its own hook ──────────────
  // Both hooks always run; the inactive one is just unused. This avoids
  // the conditional-hook violation while keeping the modal's render tree
  // simple. The cost is one extra useState tree per kind switch, which is
  // trivial for a modal lifetime.
  const preset = usePresetFormState({
    initialBaseType: initial?.baseType,
    initialPresetData: initial?.presetData,
    fallbackBase,
  });
  const script = useScriptFormState({
    initialLimits: initial?.limits,
    initialNetwork: initial?.network,
    initialCredentials: initial?.credentials,
    initialConfigSchema: initial?.configSchema,
    initialHandles: initial?.handles,
    scriptRuntime: initial?.runtime ?? "js",
    scriptEntry: initial?.entry ?? "script.js",
  });

  // Name/icon track the active kind's base plugin until the user overrides
  // them. They live here (not in the per-kind hooks) so kind switches reseed
  // them sensibly via `onKindChange`.
  const [name, setName] = useState(
    initial?.name ?? preset.base?.meta.label ?? "Custom node"
  );
  const [icon, setIcon] = useState(initial?.icon ?? preset.base?.meta.icon ?? "🧩");

  // Category is still part of the on-disk shape (used for organization
  // surfaces). New presets inherit the base plugin's category so they group
  // sensibly; new scripts default to "custom". Existing definitions are
  // loaded verbatim. The modal header icon glow uses the theme accent.
  const category: NodePlugin["meta"]["category"] =
    initial?.category ?? (kind === "script" ? "custom" : preset.base?.meta.category ?? "custom");
  const theme = useTheme();
  const glowColor = theme.accents.primary;

  if (!isOpen) return null;

  const onBaseChange = (next: string) => {
    const seed = preset.onBaseChange(next);
    if (seed.name !== undefined) setName(seed.name);
    if (seed.icon !== undefined) setIcon(seed.icon);
  };

  const onKindChange = (next: CustomNodeKind) => {
    setKind(next);
    if (next === "script") {
      setName("Script node");
      setIcon("📜");
    } else {
      onBaseChange(preset.baseType || fallbackBase);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showToast("Give the custom node a name", "error");
      return;
    }
    const active = kind === "preset" ? preset : script;
    const validationErr = active.validate();
    if (validationErr) {
      showToast(validationErr, "error");
      return;
    }
    setSaving(true);
    try {
      const id = initial?.id ?? crypto.randomUUID();
      const def = active.buildDef({ id, name, icon, category });
      await saveCustomNode(scope, def);
      if (kind === "script" && !editing) {
        await script.seedAndReveal({ id, scope, workspacePath });
      }
      const noun = kind === "script" ? "Script node" : "Custom node";
      showToast(editing ? `${noun} updated` : `${noun} created`, "success");
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

  // The network grant is stored as { mode, allow }, but the UI presents three
  // choices. "Allow all" is just the sentinel allow:["*"] — the Rust guard
  // treats "*" as any host while still blocking private/loopback unless listed
  // exactly, so it needs no new mode.
  const isAllowAll =
    script.network.mode === "allowlist" &&
    script.network.allow.length === 1 &&
    script.network.allow[0].trim() === "*";
  const netMode: "none" | "all" | "allowlist" =
    script.network.mode === "none" ? "none" : isAllowAll ? "all" : "allowlist";

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
            <span className="text-2xl" style={{ filter: `drop-shadow(0 0 6px ${glowColor}55)` }}>
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
          {/* Kind */}
          <div className="flex flex-col gap-1.5">
            <label className={formLabelClass}>Kind</label>
            {editing ? (
              <div className="text-sm text-text-secondary bg-input border border-border-subtle rounded-md px-3 py-2">
                {kind === "script"
                  ? "📜 Script — user-authored executor"
                  : "🧩 Preset — saved configuration"}
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onKindChange("preset")}
                  className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold border cursor-pointer transition-colors ${
                    kind === "preset"
                      ? "bg-accent/30 border-accent/50 text-text-main"
                      : "bg-card border-border-subtle text-text-muted hover:text-text-main"
                  }`}
                >
                  🧩 Preset
                </button>
                <button
                  type="button"
                  onClick={() => onKindChange("script")}
                  className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold border cursor-pointer transition-colors ${
                    kind === "script"
                      ? "bg-accent/30 border-accent/50 text-text-main"
                      : "bg-card border-border-subtle text-text-muted hover:text-text-main"
                  }`}
                >
                  📜 Script
                </button>
              </div>
            )}
          </div>

          {/* Base type (preset branch — upper) */}
          {kind === "preset" && (
            <PresetBaseTypeSection
              options={options}
              baseType={preset.baseType}
              onBaseChange={onBaseChange}
              lockBase={lockBase}
              base={preset.base}
            />
          )}

          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className={formLabelClass}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={formInputClass}
            />
          </div>

          {/* Icon */}
          <div className="flex flex-col gap-1.5 w-20">
            <label className={formLabelClass}>Icon</label>
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className={`${formInputClass} text-center`}
            />
          </div>

          {/* Scope (locked when editing) */}
          <div className="flex flex-col gap-1.5">
            <label className={formLabelClass}>Scope</label>
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

          {/* Preset configuration editor (preset branch — lower) */}
          {kind === "preset" && preset.base && (
            <PresetConfigSection
              base={preset.base}
              baseType={preset.baseType}
              presetData={preset.presetData}
              setPresetData={preset.setPresetData}
              workspacePath={scope === "workspace" ? workspacePath : null}
              scope={scope}
            />
          )}

          {/* Script settings (script branch) */}
          {kind === "script" && (
            <ScriptNodeForm
              editing={editing}
              scriptEntry={initial?.entry ?? "script.js"}
              opening={script.opening}
              openScriptInEditor={() => {
                if (!initial?.id) return Promise.resolve();
                return script.openScriptInEditor({
                  id: initial.id,
                  scope,
                  workspacePath,
                  showToast,
                });
              }}
              limits={script.limits}
              setLimits={script.setLimits}
              network={script.network}
              setNetwork={script.setNetwork}
              netMode={netMode}
              credentials={script.credentials}
              setCredentials={script.setCredentials}
              configSchema={script.configSchema}
              setConfigSchema={script.setConfigSchema}
              handles={script.handles}
              setHandles={script.setHandles}
              workspacePath={scope === "workspace" ? workspacePath : null}
              scope={scope}
            />
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle gap-2">
          <div className="flex gap-3">
            {editing && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="text-[11px] text-text-muted hover:text-danger border-none bg-transparent cursor-pointer underline disabled:opacity-50"
              >
                Delete
              </button>
            )}
            {editing && scope === "workspace" && (
              <button
                type="button"
                onClick={handlePromote}
                disabled={saving}
                className="text-[11px] text-text-muted hover:text-text-main border-none bg-transparent cursor-pointer underline disabled:opacity-50"
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
