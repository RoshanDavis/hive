import { useMemo, useState } from "react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { useCustomNodes } from "@/contexts/CustomNodesContext";
import { api } from "@/services/api";
import AutoDefaultsEditor from "@/components/defaults/AutoDefaultsEditor";
import CredentialGrantList from "@/components/customNodes/CredentialGrantList";
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

  const [kind, setKind] = useState<CustomNodeKind>(initial?.kind ?? "preset");
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

  const onKindChange = (next: CustomNodeKind) => {
    setKind(next);
    if (next === "script") {
      setName("Script node");
      setIcon("📜");
      setCategory("custom");
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

  const PresetEditor = base?.defaultsEditor;

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
          color,
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
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Kind
            </label>
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

          {/* Base type (preset only) */}
          {kind === "preset" && (
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
          )}

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
                className="w-full h-9.5 bg-input border border-border-subtle rounded-md cursor-pointer"
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
          {kind === "preset" && base && (
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

          {/* Script settings */}
          {kind === "script" && (
            <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Script
              </span>
              <p className="text-[11px] text-text-muted leading-relaxed m-0">
                Behavior comes from <span className="font-mono">{scriptEntry}</span> in this
                node's folder. The code runs in a sandboxed QuickJS runtime in Rust; network
                access is governed by the Network grant below. The file is the body of{" "}
                <span className="font-mono">(ctx) =&gt; {"{ … }"}</span>; return a string or an
                envelope.
              </p>

              {editing ? (
                <button
                  type="button"
                  onClick={openScriptInEditor}
                  disabled={opening}
                  className="self-start text-[11px] text-text-muted hover:text-accent border border-border-subtle hover:border-accent-dim rounded-md px-2.5 py-1.5 cursor-pointer bg-card hover:bg-card-hover transition-colors flex items-center gap-1 disabled:opacity-50"
                >
                  <span>📝</span>
                  <span>{opening ? "Opening…" : "Open script in editor"}</span>
                </button>
              ) : (
                <p className="text-[11px] text-text-muted/80 italic m-0">
                  A starter <span className="font-mono">script.js</span> is created and revealed
                  in your file manager when you click Create.
                </p>
              )}

              <div className="flex gap-3">
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Timeout (ms)
                  </label>
                  <input
                    type="number"
                    min={50}
                    max={10000}
                    value={limits.timeoutMs}
                    onChange={(e) =>
                      setLimits((l) => ({ ...l, timeoutMs: Number(e.target.value) || 0 }))
                    }
                    className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main outline-none focus:border-accent-dim"
                  />
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Memory (MB)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={Math.round(limits.memoryBytes / (1024 * 1024))}
                    onChange={(e) =>
                      setLimits((l) => ({
                        ...l,
                        memoryBytes: (Number(e.target.value) || 0) * 1024 * 1024,
                      }))
                    }
                    className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main outline-none focus:border-accent-dim"
                  />
                </div>
              </div>
              <p className="text-[10px] text-text-muted/70 m-0">
                Limits are clamped server-side (timeout ≤ 10s, memory ≤ 64 MB).
              </p>

              {/* Network grant */}
              <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Network
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setNetwork({ mode: "none", allow: [] })}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold border cursor-pointer transition-colors ${
                      netMode === "none"
                        ? "bg-accent/30 border-accent/50 text-text-main"
                        : "bg-card border-border-subtle text-text-muted hover:text-text-main"
                    }`}
                  >
                    🚫 None
                  </button>
                  <button
                    type="button"
                    onClick={() => setNetwork({ mode: "allowlist", allow: ["*"] })}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold border cursor-pointer transition-colors ${
                      netMode === "all"
                        ? "bg-accent/30 border-accent/50 text-text-main"
                        : "bg-card border-border-subtle text-text-muted hover:text-text-main"
                    }`}
                  >
                    🌐 Allow all
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setNetwork((n) => ({
                        mode: "allowlist",
                        // Coming from Allow-all, start a fresh list instead of keeping "*".
                        allow:
                          n.allow.length === 1 && n.allow[0].trim() === "*" ? [] : n.allow,
                      }))
                    }
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold border cursor-pointer transition-colors ${
                      netMode === "allowlist"
                        ? "bg-accent/30 border-accent/50 text-text-main"
                        : "bg-card border-border-subtle text-text-muted hover:text-text-main"
                    }`}
                  >
                    📝 Allowlist
                  </button>
                </div>

                {netMode === "all" && (
                  <p className="text-[10px] text-text-muted/70 m-0">
                    All public hosts allowed. Private/loopback addresses (localhost, 127.0.0.1,
                    LAN) stay blocked — switch to Allowlist and list them exactly to reach them.
                  </p>
                )}

                {netMode === "allowlist" && (
                  <div className="flex flex-col gap-1.5">
                    {network.allow.map((host, i) => (
                      <div key={i} className="flex gap-1.5">
                        <input
                          type="text"
                          value={host}
                          placeholder="api.example.com or *.example.com"
                          onChange={(e) =>
                            setNetwork((n) => {
                              const allow = [...n.allow];
                              allow[i] = e.target.value;
                              return { ...n, allow };
                            })
                          }
                          className="flex-1 bg-input border border-border-subtle rounded-md px-3 py-1.5 text-sm text-text-main outline-none focus:border-accent-dim font-mono"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setNetwork((n) => ({
                              ...n,
                              allow: n.allow.filter((_, j) => j !== i),
                            }))
                          }
                          className="text-text-muted hover:text-[#ff6b6b] border border-border-subtle rounded-md px-2 cursor-pointer bg-card hover:bg-card-hover"
                          title="Remove host"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setNetwork((n) => ({ ...n, allow: [...n.allow, ""] }))}
                      className="self-start text-[11px] text-text-muted hover:text-accent border border-dashed border-border-subtle hover:border-accent-dim rounded-md px-2 py-1 cursor-pointer bg-transparent transition-colors"
                    >
                      ＋ Add host
                    </button>
                    <p className="text-[10px] text-text-muted/70 m-0">
                      Hosts only (no path). Private/loopback addresses are blocked unless listed
                      exactly, and hosts that resolve into a private range are refused at connect time.
                    </p>
                  </div>
                )}
              </div>

              {/* Credential grants */}
              <CredentialGrantList
                granted={credentials}
                onChange={setCredentials}
                workspacePath={scope === "workspace" ? workspacePath : null}
              />

              {/* Config fields builder */}
              <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Config fields
                </label>
                {configSchema.map((field, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-1.5 bg-input/40 border border-border-subtle rounded-md p-2"
                  >
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={field.key}
                        placeholder="key"
                        onChange={(e) =>
                          setConfigSchema((s) =>
                            s.map((f, j) => (j === i ? { ...f, key: e.target.value } : f))
                          )
                        }
                        className="w-28 bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim font-mono"
                      />
                      <input
                        type="text"
                        value={field.label}
                        placeholder="Label"
                        onChange={(e) =>
                          setConfigSchema((s) =>
                            s.map((f, j) => (j === i ? { ...f, label: e.target.value } : f))
                          )
                        }
                        className="flex-1 bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim"
                      />
                      <button
                        type="button"
                        onClick={() => setConfigSchema((s) => s.filter((_, j) => j !== i))}
                        className="text-text-muted hover:text-[#ff6b6b] border border-border-subtle rounded-md px-2 cursor-pointer bg-card hover:bg-card-hover"
                        title="Remove field"
                      >
                        ×
                      </button>
                    </div>
                    <div className="flex gap-1.5 items-center">
                      <select
                        value={field.type}
                        onChange={(e) =>
                          setConfigSchema((s) =>
                            s.map((f, j) =>
                              j === i ? { ...f, type: e.target.value as ScriptField["type"] } : f
                            )
                          )
                        }
                        className="bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim"
                      >
                        {(["string", "number", "boolean", "select", "password"] as const).map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-[11px] text-text-muted cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={Boolean(field.required)}
                          onChange={(e) =>
                            setConfigSchema((s) =>
                              s.map((f, j) => (j === i ? { ...f, required: e.target.checked } : f))
                            )
                          }
                          className="w-3 h-3 cursor-pointer"
                        />
                        required
                      </label>
                      {field.type === "select" && (
                        <input
                          type="text"
                          value={(field.options ?? []).join(", ")}
                          placeholder="option1, option2"
                          onChange={(e) =>
                            setConfigSchema((s) =>
                              s.map((f, j) =>
                                j === i
                                  ? {
                                      ...f,
                                      options: e.target.value
                                        .split(",")
                                        .map((o) => o.trim())
                                        .filter(Boolean),
                                    }
                                  : f
                              )
                            )
                          }
                          className="flex-1 bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim"
                        />
                      )}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setConfigSchema((s) => [...s, { key: "", label: "", type: "string" }])
                  }
                  className="self-start text-[11px] text-text-muted hover:text-accent border border-dashed border-border-subtle hover:border-accent-dim rounded-md px-2 py-1 cursor-pointer bg-transparent transition-colors"
                >
                  ＋ Add field
                </button>
                <p className="text-[10px] text-text-muted/70 m-0">
                  Fields appear in the node inspector and are passed to the script as{" "}
                  <span className="font-mono">ctx.config</span> (keyed by <span className="font-mono">key</span>).
                </p>
              </div>

              {/* Handles editor */}
              <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Handles
                </label>
                {handles.map((h, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <input
                      type="text"
                      value={h.id ?? ""}
                      placeholder="id (optional)"
                      onChange={(e) =>
                        setHandles((hs) =>
                          hs.map((x, j) => (j === i ? { ...x, id: e.target.value } : x))
                        )
                      }
                      className="flex-1 bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim font-mono"
                    />
                    <select
                      value={h.type}
                      onChange={(e) =>
                        setHandles((hs) =>
                          hs.map((x, j) =>
                            j === i ? { ...x, type: e.target.value as HandleConfig["type"] } : x
                          )
                        )
                      }
                      className="bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim"
                    >
                      <option value="target">target (in)</option>
                      <option value="source">source (out)</option>
                    </select>
                    <select
                      value={h.position}
                      onChange={(e) =>
                        setHandles((hs) =>
                          hs.map((x, j) =>
                            j === i
                              ? { ...x, position: e.target.value as HandleConfig["position"] }
                              : x
                          )
                        )
                      }
                      className="bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim"
                    >
                      {(["left", "right", "top", "bottom"] as const).map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setHandles((hs) => hs.filter((_, j) => j !== i))}
                      className="text-text-muted hover:text-[#ff6b6b] border border-border-subtle rounded-md px-2 cursor-pointer bg-card hover:bg-card-hover"
                      title="Remove handle"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setHandles((hs) => [...hs, { type: "target", position: "left" }])
                  }
                  className="self-start text-[11px] text-text-muted hover:text-accent border border-dashed border-border-subtle hover:border-accent-dim rounded-md px-2 py-1 cursor-pointer bg-transparent transition-colors"
                >
                  ＋ Add handle
                </button>
                <p className="text-[10px] text-text-muted/70 m-0">
                  Leave empty for the default one input (left) + one output (right).
                </p>
              </div>
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
