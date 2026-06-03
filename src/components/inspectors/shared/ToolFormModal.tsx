import { useEffect, useState } from "react";
import { api, type McpServerConfig, type ToolDef } from "@/services/api";
import { toolsService, type ToolCategory, type ToolsScope } from "@/services/toolsService";
import { categoryIcon } from "@/services/builtInTools";
import { slugify } from "@/utils/slugify";
import { formInputClass, formLabelClass } from "@/components/shared/FormField";
import McpConnectionFields, { parseLines, parsePairs } from "./McpConnectionFields";
import ToolParamsEditor, { type ToolParam, paramsToJsonSchema } from "./ToolParamsEditor";
import CredentialPicker from "./CredentialPicker";
import CredentialGrantList from "@/components/customNodes/CredentialGrantList";

interface ToolFormModalProps {
  category: ToolCategory;
  workspacePath: string;
  onCreated: (id: string) => void;
  onClose: () => void;
}

const NOUNS: Record<ToolCategory, string> = {
  native: "native tool",
  mcp: "MCP server",
  skills: "skill",
};

const toggleClass = (active: boolean) =>
  `flex-1 rounded-md border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
    active
      ? "border-accent bg-accent-glow text-accent"
      : "border-border-subtle bg-card text-text-secondary hover:bg-card-hover"
  }`;

/** Create-form for a user tool / MCP server / skill. Captures name/description/icon/
 * scope plus the per-kind execution config (MCP connection · skill instructions ·
 * native HTTP endpoint or sandboxed script), persists via toolsService.addTool, then
 * selects it. All grants are stored on disk and enforced server-side at run time. */
export default function ToolFormModal({
  category,
  workspacePath,
  onCreated,
  onClose,
}: ToolFormModalProps) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [scope, setScope] = useState<ToolsScope>(workspacePath ? "workspace" : "global");
  const [mcp, setMcp] = useState<McpServerConfig>({ transport: "stdio" });
  const [instructions, setInstructions] = useState("");

  // Native user-tool authoring.
  const [nativeKind, setNativeKind] = useState<"http" | "script">("http");
  const [params, setParams] = useState<ToolParam[]>([]);
  const [httpUrl, setHttpUrl] = useState("");
  const [httpMethod, setHttpMethod] = useState("GET");
  const [httpHeaders, setHttpHeaders] = useState("");
  const [httpBody, setHttpBody] = useState("");
  const [httpCredId, setHttpCredId] = useState<string | null>(null);
  const [httpCredHeader, setHttpCredHeader] = useState("Authorization");
  const [httpCredPrefix, setHttpCredPrefix] = useState("Bearer ");
  const [httpAllow, setHttpAllow] = useState("");
  const [scriptAllow, setScriptAllow] = useState("");
  const [scriptCreds, setScriptCreds] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        const allow = parseLines(httpAllow);
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
            allow: allow.length ? allow : undefined,
          },
        };
      }
      const allow = parseLines(scriptAllow);
      return {
        parameters,
        script: {
          runtime: "js",
          network: allow.length ? { mode: "allowlist", allow } : { mode: "none", allow: [] },
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
      const id = slugify(trimmed);
      await toolsService.addTool(
        scope,
        category,
        {
          id,
          label: trimmed,
          description: description.trim() || undefined,
          icon: icon.trim() || undefined,
          ...extra,
        },
        workspacePath
      );
      if (category === "skills" && instructions.trim()) {
        await api.saveSkillContent(scope, id, instructions, workspacePath || null);
      }
      onCreated(id);
    } catch (err) {
      setError(String(err));
      setSaving(false);
    }
  };

  const noun = NOUNS[category];

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
          <span className="text-sm font-bold text-text-main">Create a {noun}</span>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-main text-xl cursor-pointer border-none bg-transparent w-7 h-7 flex items-center justify-center rounded-md hover:bg-card-hover"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-4 overflow-y-auto scrollbar-thin">
          <div className="flex flex-col gap-1">
            <label className={formLabelClass}>Name</label>
            <input
              autoFocus
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
              <McpConnectionFields value={mcp} onChange={setMcp} />
            </div>
          )}

          {category === "skills" && (
            <div className="flex flex-col gap-1">
              <label className={formLabelClass}>Instructions (SKILL.md)</label>
              <textarea
                className={`${formInputClass} font-mono`}
                rows={5}
                value={instructions}
                placeholder="When this skill applies, and the steps the agent should follow when it loads this skill…"
                onChange={(e) => setInstructions(e.target.value)}
              />
              <span className="text-[11px] text-text-muted">
                Markdown. You can also edit this file later in your own editor.
              </span>
            </div>
          )}

          {category === "native" && (
            <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
              <div className="flex flex-col gap-1">
                <label className={formLabelClass}>How it runs</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setNativeKind("http")} className={toggleClass(nativeKind === "http")}>
                    🌐 HTTP request
                  </button>
                  <button type="button" onClick={() => setNativeKind("script")} className={toggleClass(nativeKind === "script")}>
                    📜 Script (sandboxed)
                  </button>
                </div>
              </div>

              <ToolParamsEditor value={params} onChange={setParams} />

              {nativeKind === "http" ? (
                <>
                  <div className="flex gap-2">
                    <select
                      className={`${formInputClass} cursor-pointer w-28`}
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
                      className={`${formInputClass} flex-1`}
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
                  <div className="flex flex-col gap-1">
                    <label className={formLabelClass}>Allowed hosts (one per line; defaults to the URL's host)</label>
                    <textarea
                      className={`${formInputClass} font-mono`}
                      rows={1}
                      value={httpAllow}
                      placeholder="*.example.com"
                      onChange={(e) => setHttpAllow(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-text-muted m-0">
                    Returns its value to the model. Author the code in <code>script.js</code> after
                    creating (click the tool → “Open script.js”). The model's arguments arrive as{" "}
                    <code>ctx.config</code>.
                  </p>
                  <div className="flex flex-col gap-1">
                    <label className={formLabelClass}>Network allowlist (one host per line; empty = no network)</label>
                    <textarea
                      className={`${formInputClass} font-mono`}
                      rows={2}
                      value={scriptAllow}
                      placeholder="api.example.com"
                      onChange={(e) => setScriptAllow(e.target.value)}
                    />
                  </div>
                  <CredentialGrantList
                    granted={scriptCreds}
                    onChange={setScriptCreds}
                    workspacePath={workspacePath || null}
                  />
                </>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className={formLabelClass}>Scope</label>
            <div className="flex gap-2">
              {workspacePath && (
                <button type="button" onClick={() => setScope("workspace")} className={toggleClass(scope === "workspace")}>
                  📁 Workspace
                </button>
              )}
              <button type="button" onClick={() => setScope("global")} className={toggleClass(scope === "global")}>
                🌐 Global
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border-subtle bg-card px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-card-hover cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !label.trim()}
              className="rounded-md border border-accent bg-accent-glow px-3 py-1.5 text-xs font-semibold text-accent enabled:cursor-pointer enabled:hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
