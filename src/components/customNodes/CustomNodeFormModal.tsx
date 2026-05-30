import { useMemo, useState } from "react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { useCustomNodes } from "@/contexts/CustomNodesContext";
import { api } from "@/services/api";
import {
  PresetBaseTypeSection,
  PresetConfigSection,
} from "@/components/customNodes/PresetNodeForm";
import ScriptNodeForm from "@/components/customNodes/ScriptNodeForm";
import { formInputClass, formLabelClass } from "@/components/shared/FormField";
import { getCategoryColor } from "@/theme/colors";
import {
  isCustomType,
  type CustomNodeDefinition,
  type CustomNodeScope,
  type NetworkGrant,
  type ScriptField,
  type ScriptLimits,
} from "@/types/customNodes";
import type { HandleConfig, NodePlugin } from "@/engine/plugin";

type CustomNodeKind = "preset" | "script";

const DEFAULT_SCRIPT_LIMITS: ScriptLimits = {
  timeoutMs: 5000,
  memoryBytes: 16 * 1024 * 1024,
};

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

/**
 * Validate a script definition's authoring fields. Config keys must be non-empty and
 * unique (they key into `ctx.config`); handle ids must be non-empty and unique once
 * there's more than one handle, or React Flow can't disambiguate which handle an edge
 * connects to. Returns an error message, or null when valid.
 */
function validateScriptDef(
  configSchema: ScriptField[],
  handles: HandleConfig[]
): string | null {
  const keys = configSchema.map((f) => f.key.trim());
  if (keys.some((k) => k === "")) return "Every config field needs a non-empty key.";
  const dupKey = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dupKey) return `Duplicate config field key: "${dupKey}".`;

  if (handles.length > 1) {
    const ids = handles.map((h) => (h.id ?? "").trim());
    if (ids.some((id) => id === ""))
      return "With more than one handle, every handle needs a non-empty id.";
    const dupId = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dupId) return `Duplicate handle id: "${dupId}".`;
  }
  return null;
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
  const { saveCustomNode, deleteCustomNode, promoteToGlobal, workspacePath } = useCustomNodes();

  const editing = Boolean(initial?.id);
  const options = useMemo(baseTypeOptions, []);
  const fallbackBase = options[0]?.type ?? "";

  const [kind, setKind] = useState<CustomNodeKind>(initial?.kind ?? "preset");
  const [baseType, setBaseType] = useState(initial?.baseType ?? fallbackBase);
  const base = pluginRegistry.get(baseType);

  const [name, setName] = useState(initial?.name ?? base?.meta.label ?? "Custom node");
  const [icon, setIcon] = useState(initial?.icon ?? base?.meta.icon ?? "🧩");
  // Category drives the synthesized plugin's color. New presets inherit the
  // base plugin's category so they group sensibly; new scripts default to
  // "custom". Existing definitions on disk are loaded verbatim.
  const category: NodePlugin["meta"]["category"] =
    initial?.category ?? (kind === "script" ? "custom" : base?.meta.category ?? "custom");
  const color = getCategoryColor(category);
  const [scope, setScope] = useState<CustomNodeScope>(
    initial?.scope ?? (allowWorkspaceScope ? "workspace" : "global")
  );
  const [presetData, setPresetData] = useState<Record<string, unknown>>(
    initial?.presetData ?? {}
  );
  const [limits, setLimits] = useState<ScriptLimits>(
    initial?.limits ?? DEFAULT_SCRIPT_LIMITS
  );
  const [network, setNetwork] = useState<NetworkGrant>(
    initial?.network ?? { mode: "none", allow: [] }
  );
  const [credentials, setCredentials] = useState<string[]>(initial?.credentials ?? []);
  const [configSchema, setConfigSchema] = useState<ScriptField[]>(
    initial?.configSchema ?? []
  );
  const [handles, setHandles] = useState<HandleConfig[]>(initial?.handles ?? []);
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);

  // Script fields not edited in the UI — preserved verbatim on edit.
  const scriptRuntime = initial?.runtime ?? "js";
  const scriptEntry = initial?.entry ?? "script.js";

  if (!isOpen) return null;

  // When the base type changes in create mode, refresh meta defaults to match.
  // Category is read off the base plugin (used to derive the icon glow color);
  // changing the base type implicitly reshapes the category via `base?.meta.category`.
  const onBaseChange = (next: string) => {
    setBaseType(next);
    const p = pluginRegistry.get(next);
    if (p) {
      setName(p.meta.label);
      setIcon(p.meta.icon);
    }
    setPresetData({});
  };

  const onKindChange = (next: CustomNodeKind) => {
    setKind(next);
    if (next === "script") {
      setName("Script node");
      setIcon("📜");
    } else {
      onBaseChange(baseType || fallbackBase);
    }
  };

  const openScriptInEditor = async () => {
    if (!initial?.id) return;
    setOpening(true);
    try {
      await api.openCustomNodeScript(
        scope,
        initial.id,
        scope === "workspace" ? workspacePath : null
      );
    } catch (err) {
      showToast(`Failed to open script: ${err}`, "error");
    } finally {
      setOpening(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showToast("Give the custom node a name", "error");
      return;
    }
    if (kind === "preset" && !base) {
      showToast("Pick a base node type first", "error");
      return;
    }
    if (kind === "script") {
      const scriptErr = validateScriptDef(configSchema, handles);
      if (scriptErr) {
        showToast(scriptErr, "error");
        return;
      }
    }
    setSaving(true);
    try {
      const id = initial?.id ?? crypto.randomUUID();

      if (kind === "script") {
        // Persist trimmed keys/ids (validated above) so on-disk config keys and handle
        // ids never carry stray whitespace. A lone handle may keep an empty (undefined) id.
        const normConfig = configSchema.map((f) => ({
          ...f,
          key: f.key.trim(),
          label: f.label.trim(),
        }));
        const normHandles = handles.map((h) => ({
          ...h,
          id: (h.id ?? "").trim() || undefined,
        }));
        const def: CustomNodeDefinition = {
          id,
          kind: "script",
          name: name.trim(),
          icon: icon.trim() || "📜",
          category,
          version: 1,
          runtime: scriptRuntime,
          entry: scriptEntry,
          configSchema: normConfig,
          network,
          credentials,
          limits,
          ...(normHandles.length > 0 ? { handles: normHandles } : {}),
        };
        await saveCustomNode(scope, def);
        // Seed + reveal script.js so the user can start editing right away.
        if (!editing) {
          try {
            await api.openCustomNodeScript(
              scope,
              id,
              scope === "workspace" ? workspacePath : null
            );
          } catch {
            /* non-fatal: the node is saved; the inspector offers "Open" too */
          }
        }
        showToast(editing ? "Script node updated" : "Script node created", "success");
        onClose();
        return;
      }

      // Preset: `label` is owned by the preset name (see synthesizePlugin) — don't
      // store it redundantly in presetData.
      const { label: _label, ...cleanPreset } = presetData;
      const def: CustomNodeDefinition = {
        id,
        kind: "preset",
        name: name.trim(),
        icon: icon.trim() || "🧩",
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

  // The network grant is stored as { mode, allow }, but the UI presents three choices.
  // "Allow all" is just the sentinel allow:["*"] — the Rust guard treats "*" as any host
  // while still blocking private/loopback unless listed exactly, so it needs no new mode.
  const isAllowAll =
    network.mode === "allowlist" &&
    network.allow.length === 1 &&
    network.allow[0].trim() === "*";
  const netMode: "none" | "all" | "allowlist" =
    network.mode === "none" ? "none" : isAllowAll ? "all" : "allowlist";

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
          {/* Kind */}
          <div className="flex flex-col gap-1.5">
            <label className={formLabelClass}>Kind</label>
            {editing ? (
              <div className="text-sm text-text-secondary bg-input border border-border-subtle rounded-md px-3 py-2">
                {kind === "script" ? "📜 Script — user-authored executor" : "🧩 Preset — saved configuration"}
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
              baseType={baseType}
              onBaseChange={onBaseChange}
              lockBase={lockBase}
              base={base}
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
          {kind === "preset" && base && (
            <PresetConfigSection
              base={base}
              baseType={baseType}
              presetData={presetData}
              setPresetData={setPresetData}
              workspacePath={scope === "workspace" ? workspacePath : null}
              scope={scope}
            />
          )}

          {/* Script settings (script branch) */}
          {kind === "script" && (
            <ScriptNodeForm
              editing={editing}
              scriptEntry={scriptEntry}
              opening={opening}
              openScriptInEditor={openScriptInEditor}
              limits={limits}
              setLimits={setLimits}
              network={network}
              setNetwork={setNetwork}
              netMode={netMode}
              credentials={credentials}
              setCredentials={setCredentials}
              configSchema={configSchema}
              setConfigSchema={setConfigSchema}
              handles={handles}
              setHandles={setHandles}
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
