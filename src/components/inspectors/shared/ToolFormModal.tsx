import { useEffect, useState } from "react";
import { api, type McpServerConfig, type ToolDef } from "@/services/api";
import type { AgentToolSettings } from "@/nodes/types";
import type { NetworkGrant } from "@/types/customNodes";
import { toolsService, type ToolCategory, type ToolsScope } from "@/services/toolsService";
import { categoryIcon, builtinCredentialSchema, getBuiltinCredentialId } from "@/services/builtInTools";
import { slugify } from "@/utils/slugify";
import {
  formInputBaseClass,
  formInputClass,
  formLabelClass,
  segmentedButtonClass,
} from "@/components/shared/FormField";
import McpConnectionFields, { parsePairs, serializePairs } from "./McpConnectionFields";
import ToolParamsEditor, {
  type ToolParam,
  paramsToJsonSchema,
  jsonSchemaToParams,
} from "./ToolParamsEditor";
import CredentialPicker from "./CredentialPicker";
import CredentialGrantList from "@/components/customNodes/CredentialGrantList";
import NetworkAllowlistEditor from "@/components/shared/NetworkAllowlistEditor";

interface ToolFormModalProps {
  category: ToolCategory;
  workspacePath: string;
  /** Present ⇒ edit/configure an existing tool; omit ⇒ create a new one. */
  initial?: { def: ToolDef; scope: ToolsScope | null };
  /** Per-tool settings (e.g. web_search's bound credential). Omit to hide that UI. */
  toolSettings?: AgentToolSettings;
  onToolSettingsChange?: (next: AgentToolSettings) => void;
  /** Called after a successful create or save, with the tool id. */
  onSaved: (id: string) => void;
  /** When provided, shows a "Remove from agent" button (deselect this tool). */
  onRemove?: () => void;
  onClose: () => void;
}

const NOUNS: Record<ToolCategory, string> = {
  native: "native tool",
  mcp: "MCP server",
  skills: "skill",
};

/** Map an HTTP tool's `allow` list ↔ the shared {@link NetworkGrant} editor.
 * Empty ⇒ "None" (the request still reaches its own URL host); `["*"]` ⇒ allow all. */
const httpAllowToGrant = (allow?: string[]): NetworkGrant =>
  allow && allow.length ? { mode: "allowlist", allow } : { mode: "none", allow: [] };
const grantToHttpAllow = (g: NetworkGrant): string[] | undefined => {
  if (g.mode === "none") return undefined;
  const hosts = g.allow.map((h) => h.trim()).filter(Boolean);
  return hosts.length ? hosts : undefined;
};

/**
 * Single modal for a user tool / MCP server / skill that **creates, edits, and
 * configures**. Three modes derived from `initial` + whether it's a built-in:
 *   - **create** (no `initial`): empty form, scope selectable.
 *   - **edit** (`initial` is a user tool on disk): pre-filled form, scope locked,
 *     full in-place editing of the per-kind config; Save → `toolsService.updateTool`.
 *   - **config** (`initial` is a built-in): read-only details + per-tool settings
 *     (web_search's Brave key); no name/scope/params editing.
 * All grants are stored on disk and enforced server-side at run time.
 */
export default function ToolFormModal({
  category,
  workspacePath,
  initial,
  toolSettings,
  onToolSettingsChange,
  onSaved,
  onRemove,
  onClose,
}: ToolFormModalProps) {
  const def = initial?.def;
  const isBuiltIn = def ? toolsService.isBuiltIn(category, def.id) : false;
  const creating = !initial;
  const editing = Boolean(initial) && !isBuiltIn; // a user tool on disk
  const viewing = Boolean(initial) && isBuiltIn; // a built-in: read-only
  // The credential schema a built-in requires (e.g. web_search → webSearch), or null.
  const builtinCredSchema = def ? builtinCredentialSchema(def.id) : null;

  const [label, setLabel] = useState(def?.label ?? "");
  const [description, setDescription] = useState(def?.description ?? "");
  const [icon, setIcon] = useState(def?.icon ?? "");
  const [scope, setScope] = useState<ToolsScope>(
    initial?.scope ?? (workspacePath ? "workspace" : "global")
  );
  const [mcp, setMcp] = useState<McpServerConfig>(def?.mcp ?? { transport: "stdio" });
  const [instructions, setInstructions] = useState("");

  // Native user-tool authoring (seeded from an existing def when editing).
  const [nativeKind, setNativeKind] = useState<"http" | "script">(def?.script ? "script" : "http");
  const [params, setParams] = useState<ToolParam[]>(jsonSchemaToParams(def?.parameters));
  const [httpUrl, setHttpUrl] = useState(def?.http?.url ?? "");
  const [httpMethod, setHttpMethod] = useState(def?.http?.method ?? "GET");
  const [httpHeaders, setHttpHeaders] = useState(serializePairs(def?.http?.headers, ": "));
  const [httpBody, setHttpBody] = useState(def?.http?.bodyTemplate ?? "");
  const [httpCredId, setHttpCredId] = useState<string | null>(def?.http?.credentialId ?? null);
  const [httpCredHeader, setHttpCredHeader] = useState(def?.http?.credentialHeader ?? "Authorization");
  const [httpCredPrefix, setHttpCredPrefix] = useState(def?.http?.credentialPrefix ?? "Bearer ");
  const [httpNet, setHttpNet] = useState<NetworkGrant>(httpAllowToGrant(def?.http?.allow));
  const [scriptNet, setScriptNet] = useState<NetworkGrant>(
    def?.script?.network ?? { mode: "none", allow: [] }
  );
  const [scriptCreds, setScriptCreds] = useState<string[]>(def?.script?.credentials ?? []);

  // The on-disk scope holding this tool (for skill SKILL.md writes + script.js).
  const [resolvedScope, setResolvedScope] = useState<ToolsScope | null>(initial?.scope ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSkill = category === "skills";
  const isScriptTool = category === "native" && Boolean(def?.script);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Resolve the on-disk scope for an existing user tool (needed for skill/script ops).
  useEffect(() => {
    if (creating || !def || resolvedScope) return;
    let cancelled = false;
    void toolsService.scopeOf(category, def.id, workspacePath || null).then((s) => {
      if (!cancelled) setResolvedScope(s);
    });
    return () => {
      cancelled = true;
    };
  }, [creating, def, category, workspacePath, resolvedScope]);

  // Load an existing skill's SKILL.md body for editing.
  useEffect(() => {
    if (!isSkill || creating || !def) return;
    let cancelled = false;
    void api.loadSkillContent(workspacePath || null, def.id).then((c) => {
      if (!cancelled) setInstructions(c);
    });
    return () => {
      cancelled = true;
    };
  }, [isSkill, creating, def, workspacePath]);

  const effectiveScope = creating ? scope : resolvedScope;

  /** Build the kind-specific config blob to persist on the ToolDef. */
  const buildExtra = (): Partial<ToolDef> | { __error: string } => {
    if (category === "mcp") {
      if (mcp.transport === "stdio" && !mcp.command) return { __error: "A stdio MCP server needs a command." };
      if (mcp.transport === "http" && !mcp.url) return { __error: "An HTTP MCP server needs a URL." };
      return { mcp };
    }
    if (category === "native") {
      const parameters = params.length ? paramsToJsonSchema(params) : undefined;
      if (nativeKind === "http") {
        if (!httpUrl.trim()) return { __error: "An HTTP tool needs a URL." };
        const headers = parsePairs(httpHeaders, ":");
        return {
          parameters,
          http: {
            url: httpUrl.trim(),
            method: httpMethod,
            headers: Object.keys(headers).length ? headers : undefined,
            bodyTemplate: httpBody.trim() || undefined,
            credentialId: httpCredId || undefined,
            ...(httpCredId
              ? { credentialHeader: httpCredHeader || undefined, credentialPrefix: httpCredPrefix }
              : {}),
            allow: grantToHttpAllow(httpNet),
          },
        };
      }
      return {
        parameters,
        script: {
          runtime: "js",
          network:
            scriptNet.mode === "allowlist" && scriptNet.allow.some((h) => h.trim())
              ? { mode: "allowlist", allow: scriptNet.allow.map((h) => h.trim()).filter(Boolean) }
              : { mode: "none", allow: [] },
          credentials: scriptCreds.length ? scriptCreds : undefined,
        },
      };
    }
    return {};
  };

  const handleSave = async () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    const extra = buildExtra();
    if ("__error" in extra) {
      setError(extra.__error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = creating ? slugify(trimmed) : def!.id;
      const nextDef: ToolDef = {
        id,
        label: trimmed,
        description: description.trim() || undefined,
        icon: icon.trim() || undefined,
        ...extra,
      };
      if (creating) {
        await toolsService.addTool(scope, category, nextDef, workspacePath);
      } else {
        await toolsService.updateTool(category, nextDef, workspacePath || null);
      }
      if (isSkill && effectiveScope) {
        await api.saveSkillContent(effectiveScope, id, instructions, workspacePath || null);
      }
      // A freshly-created script tool: seed + reveal its script.js right away so the
      // user can author the code as part of creating it (no reopen-to-edit step).
      if (creating && category === "native" && nativeKind === "script") {
        try {
          await api.openToolScript(scope, id, workspacePath || null);
        } catch {
          // Non-fatal — the tool is saved; they can open the script from its card later.
        }
      }
      onSaved(id);
    } catch (err) {
      setError(String(err));
      setSaving(false);
    }
  };

  const noun = NOUNS[category];
  const title = viewing
    ? def!.label
    : editing
      ? `Edit ${noun}`
      : `Create a ${noun}`;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border-subtle rounded-xl shadow-card-hover w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-2 min-w-0">
            {viewing && <span className="text-xl">{def!.icon || categoryIcon(category)}</span>}
            <span className="text-sm font-bold text-text-main truncate">{title}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-main text-xl cursor-pointer border-none bg-transparent w-7 h-7 flex items-center justify-center rounded-md hover:bg-card-hover"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-4 overflow-y-auto scrollbar-thin">
          {/* Built-in (view) mode: description + runnable hint only. */}
          {viewing && (
            <>
              {def!.description && (
                <p className="text-[12px] text-text-secondary m-0 leading-relaxed">
                  {def!.description}
                </p>
              )}
              <div className="text-[11px] rounded-md px-2.5 py-1.5 text-text-muted bg-card/60 border border-border-subtle">
                ✓ This built-in tool runs when the agent calls it.
              </div>
            </>
          )}

          {/* Create / edit fields. */}
          {!viewing && (
            <>
              <div className="flex flex-col gap-1">
                <label className={formLabelClass}>Name</label>
                <input
                  autoFocus={creating}
                  className={formInputClass}
                  type="text"
                  value={label}
                  placeholder={`e.g. My ${noun}`}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSave();
                    }
                  }}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className={formLabelClass}>Description</label>
                <input
                  className={formInputClass}
                  type="text"
                  value={description}
                  placeholder="What this tool does (shown to you and the model)"
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className={formLabelClass}>Icon (emoji, optional)</label>
                <input
                  className={formInputClass}
                  type="text"
                  value={icon}
                  placeholder={categoryIcon(category)}
                  onChange={(e) => setIcon(e.target.value)}
                />
              </div>

              {category === "mcp" && (
                <div className="flex flex-col gap-1">
                  <label className={formLabelClass}>Connection</label>
                  <McpConnectionFields value={mcp} onChange={setMcp} workspacePath={workspacePath || null} />
                </div>
              )}

              {category === "skills" && (
                <div className="flex flex-col gap-1">
                  <label className={formLabelClass}>Instructions (SKILL.md)</label>
                  <textarea
                    className={`${formInputClass} font-mono`}
                    rows={6}
                    value={instructions}
                    placeholder="When this skill applies, and the steps the agent should follow when it loads this skill…"
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                  <span className="text-[11px] text-text-muted">
                    Markdown. You can also edit this file later in your own editor.
                  </span>
                  {editing && resolvedScope && (
                    <button
                      type="button"
                      onClick={() =>
                        void api.openSkillInstructions(resolvedScope, def!.id, workspacePath || null)
                      }
                      className="self-start mt-1 rounded-md border border-border-subtle bg-card px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-card-hover cursor-pointer"
                    >
                      Open in editor
                    </button>
                  )}
                </div>
              )}

              {category === "native" && (
                <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
                  <div className="flex flex-col gap-1">
                    <label className={formLabelClass}>How it runs</label>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setNativeKind("http")} className={segmentedButtonClass(nativeKind === "http")}>
                        🌐 HTTP request
                      </button>
                      <button type="button" onClick={() => setNativeKind("script")} className={segmentedButtonClass(nativeKind === "script")}>
                        📜 Script (sandboxed)
                      </button>
                    </div>
                  </div>

                  <ToolParamsEditor value={params} onChange={setParams} />

                  {nativeKind === "http" ? (
                    <>
                      <div className="flex gap-2">
                        <select
                          className={`${formInputBaseClass} cursor-pointer w-28 shrink-0`}
                          value={httpMethod}
                          onChange={(e) => setHttpMethod(e.target.value)}
                        >
                          {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                        <input
                          className={`${formInputBaseClass} flex-1 min-w-0`}
                          type="text"
                          value={httpUrl}
                          placeholder="https://api.example.com/items/{{id}}"
                          onChange={(e) => setHttpUrl(e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className={formLabelClass}>Headers (Header: value per line, optional)</label>
                        <textarea
                          className={`${formInputClass} font-mono`}
                          rows={2}
                          value={httpHeaders}
                          placeholder="Accept: application/json"
                          onChange={(e) => setHttpHeaders(e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className={formLabelClass}>Body template (optional, {"{{arg}}"} substituted)</label>
                        <textarea
                          className={`${formInputClass} font-mono`}
                          rows={2}
                          value={httpBody}
                          placeholder={'{"query": "{{query}}"}'}
                          onChange={(e) => setHttpBody(e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className={formLabelClass}>Credential (optional, injected as a header)</label>
                        <CredentialPicker
                          schemaTypes={["apiToken"]}
                          selectedCredentialId={httpCredId}
                          onSelect={setHttpCredId}
                          workspacePath={workspacePath || null}
                          allowOtherTypes
                        />
                        {httpCredId && (
                          <div className="flex gap-2 mt-1">
                            <input
                              className={`${formInputClass} flex-1`}
                              type="text"
                              value={httpCredHeader}
                              placeholder="Header (e.g. Authorization)"
                              onChange={(e) => setHttpCredHeader(e.target.value)}
                            />
                            <input
                              className={`${formInputClass} flex-1`}
                              type="text"
                              value={httpCredPrefix}
                              placeholder="Prefix (e.g. 'Bearer ')"
                              onChange={(e) => setHttpCredPrefix(e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                      <NetworkAllowlistEditor
                        label="Allowed hosts"
                        value={httpNet}
                        onChange={setHttpNet}
                      />
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] text-text-muted m-0">
                        Returns its value to the model. Author the code in <code>script.js</code>
                        {editing ? " (button below)" : " — it opens for editing as soon as you click Create"}.
                        The model's arguments arrive as <code>ctx.config</code>.
                      </p>
                      {isScriptTool && editing && resolvedScope && (
                        <button
                          type="button"
                          onClick={() =>
                            void api.openToolScript(resolvedScope, def!.id, workspacePath || null)
                          }
                          className="self-start rounded-md border border-border-subtle bg-card px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-card-hover cursor-pointer"
                        >
                          Open script.js in editor
                        </button>
                      )}
                      <NetworkAllowlistEditor value={scriptNet} onChange={setScriptNet} />
                      <CredentialGrantList
                        granted={scriptCreds}
                        onChange={setScriptCreds}
                        workspacePath={workspacePath || null}
                      />
                    </>
                  )}
                </div>
              )}

              {/* Scope: selectable when creating, fixed once on disk. */}
              <div className="flex flex-col gap-1">
                <label className={formLabelClass}>Scope</label>
                {creating ? (
                  <div className="flex gap-2">
                    {workspacePath && (
                      <button type="button" onClick={() => setScope("workspace")} className={segmentedButtonClass(scope === "workspace")}>
                        📁 Workspace
                      </button>
                    )}
                    <button type="button" onClick={() => setScope("global")} className={segmentedButtonClass(scope === "global")}>
                      🌐 Global
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-text-muted">
                    {resolvedScope === "workspace" ? "📁 Workspace" : resolvedScope === "global" ? "🌐 Global" : "—"}
                  </span>
                )}
              </div>
            </>
          )}

          {/* Built-in credential binding — declaration-driven (e.g. Brave Web Search). */}
          {def && builtinCredSchema && onToolSettingsChange && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] text-text-muted m-0">🔑 {def.label} uses a saved credential:</p>
              <CredentialPicker
                schemaTypes={[builtinCredSchema]}
                selectedCredentialId={getBuiltinCredentialId(toolSettings, def.id)}
                onSelect={(id) => {
                  const credentialIds = { ...toolSettings?.credentialIds };
                  if (id) credentialIds[def.id] = id;
                  else delete credentialIds[def.id];
                  onToolSettingsChange({ ...toolSettings, credentialIds });
                }}
                workspacePath={workspacePath || null}
                allowOtherTypes
              />
            </div>
          )}

          {error && (
            <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger">
              {error}
            </div>
          )}

          <div className="flex justify-between items-center mt-1">
            {onRemove ? (
              <button
                type="button"
                onClick={() => {
                  onRemove();
                  onClose();
                }}
                className="rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/20 cursor-pointer"
              >
                Remove from agent
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border-subtle bg-card px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-card-hover cursor-pointer"
              >
                {viewing ? "Done" : "Cancel"}
              </button>
              {!viewing && (
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || !label.trim()}
                  className="rounded-md border border-accent bg-accent-glow px-3 py-1.5 text-xs font-semibold text-accent enabled:cursor-pointer enabled:hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saving ? (editing ? "Saving…" : "Creating…") : editing ? "Save" : "Create"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
