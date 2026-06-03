import { useEffect, useState } from "react";
import { api, type McpServerConfig, type ToolDef } from "@/services/api";
import type { AgentToolSettings } from "@/nodes/types";
import { toolsService, type ToolCategory, type ToolsScope } from "@/services/toolsService";
import { categoryIcon } from "@/services/builtInTools";
import CredentialPicker from "./CredentialPicker";
import McpConnectionFields from "./McpConnectionFields";
import { formInputClass } from "@/components/shared/FormField";

interface ToolConfigModalProps {
  category: ToolCategory;
  def: ToolDef;
  /** Whether this tool actually runs today (false ⇒ "not runnable yet" notice). */
  runnable: boolean;
  workspacePath: string;
  toolSettings?: AgentToolSettings;
  onToolSettingsChange?: (next: AgentToolSettings) => void;
  /** Deselect this tool from the agent. */
  onRemove: () => void;
  onClose: () => void;
}

/** Details + per-tool configuration for a selected tool card. Today only
 * web_search has config (its Brave Search credential); other tools show their
 * description + runnable status. */
export default function ToolConfigModal({
  category,
  def,
  runnable,
  workspacePath,
  toolSettings,
  onToolSettingsChange,
  onRemove,
  onClose,
}: ToolConfigModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isWebSearch = def.id === "web_search";
  const isMcp = category === "mcp";
  const isSkill = category === "skills";
  const isScriptTool = category === "native" && Boolean(def.script);

  // Script tools: resolve which scope holds the tool so we can open its script.js.
  const [toolScope, setToolScope] = useState<ToolsScope | null>(null);
  useEffect(() => {
    if (!isScriptTool) return;
    let cancelled = false;
    void toolsService.scopeOf("native", def.id, workspacePath || null).then((s) => {
      if (!cancelled) setToolScope(s);
    });
    return () => {
      cancelled = true;
    };
  }, [isScriptTool, def.id, workspacePath]);

  const [mcp, setMcp] = useState<McpServerConfig>(def.mcp ?? { transport: "stdio" });
  const [savingMcp, setSavingMcp] = useState(false);
  const [mcpSaved, setMcpSaved] = useState(false);

  const saveMcp = async () => {
    setSavingMcp(true);
    try {
      await toolsService.updateTool("mcp", { ...def, mcp }, workspacePath || null);
      setMcpSaved(true);
    } finally {
      setSavingMcp(false);
    }
  };

  // Skills: load the SKILL.md body + resolve which scope holds the skill (needed
  // to write the body back to the right place).
  const [skillText, setSkillText] = useState("");
  const [skillScope, setSkillScope] = useState<ToolsScope | null>(null);
  const [savingSkill, setSavingSkill] = useState(false);
  const [skillSaved, setSkillSaved] = useState(false);

  useEffect(() => {
    if (!isSkill) return;
    let cancelled = false;
    void (async () => {
      const [content, scope] = await Promise.all([
        api.loadSkillContent(workspacePath || null, def.id),
        toolsService.scopeOf("skills", def.id, workspacePath || null),
      ]);
      if (!cancelled) {
        setSkillText(content);
        setSkillScope(scope);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSkill, def.id, workspacePath]);

  const saveSkill = async () => {
    if (!skillScope) return;
    setSavingSkill(true);
    try {
      await api.saveSkillContent(skillScope, def.id, skillText, workspacePath || null);
      setSkillSaved(true);
    } finally {
      setSavingSkill(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border-subtle rounded-xl shadow-card-hover w-full max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl">{def.icon || categoryIcon(category)}</span>
            <span className="text-sm font-bold text-text-main truncate">{def.label}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-main text-xl cursor-pointer border-none bg-transparent w-7 h-7 flex items-center justify-center rounded-md hover:bg-card-hover"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-4">
          {def.description && (
            <p className="text-[12px] text-text-secondary m-0 leading-relaxed">{def.description}</p>
          )}

          {!isMcp && !isSkill && (
            <div
              className={`text-[11px] rounded-md px-2.5 py-1.5 ${
                runnable
                  ? "text-text-muted bg-card/60 border border-border-subtle"
                  : "text-warning bg-warning/10 border border-warning/30"
              }`}
            >
              {runnable
                ? "✓ This tool runs when the agent calls it."
                : "⏳ Not runnable yet — it's saved to your selection but won't be called until support for this tool type lands."}
            </div>
          )}

          {isScriptTool && (
            <button
              type="button"
              onClick={() =>
                toolScope && void api.openToolScript(toolScope, def.id, workspacePath || null)
              }
              disabled={!toolScope}
              className="self-start rounded-md border border-border-subtle bg-card px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-card-hover enabled:cursor-pointer disabled:opacity-40"
            >
              Open script.js in editor
            </button>
          )}

          {isMcp && (
            <div className="flex flex-col gap-2">
              <McpConnectionFields
                value={mcp}
                onChange={(next) => {
                  setMcp(next);
                  setMcpSaved(false);
                }}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveMcp()}
                  disabled={savingMcp}
                  className="rounded-md border border-accent bg-accent-glow px-3 py-1.5 text-xs font-semibold text-accent enabled:cursor-pointer enabled:hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingMcp ? "Saving…" : "Save connection"}
                </button>
                {mcpSaved && (
                  <span className="text-[11px] text-accent">✓ Saved — applies on the next run.</span>
                )}
              </div>
            </div>
          )}

          {isSkill && (
            <div className="flex flex-col gap-2">
              <label className="text-[11px] text-text-muted m-0">
                📝 Instructions (SKILL.md) — the agent loads these via the load_skill tool:
              </label>
              <textarea
                className={`${formInputClass} font-mono`}
                rows={6}
                value={skillText}
                placeholder="When this skill applies, and the steps the agent should follow…"
                onChange={(e) => {
                  setSkillText(e.target.value);
                  setSkillSaved(false);
                }}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveSkill()}
                  disabled={savingSkill || !skillScope}
                  className="rounded-md border border-accent bg-accent-glow px-3 py-1.5 text-xs font-semibold text-accent enabled:cursor-pointer enabled:hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingSkill ? "Saving…" : "Save instructions"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    skillScope &&
                    void api.openSkillInstructions(skillScope, def.id, workspacePath || null)
                  }
                  disabled={!skillScope}
                  className="rounded-md border border-border-subtle bg-card px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-card-hover enabled:cursor-pointer disabled:opacity-40"
                >
                  Open in editor
                </button>
                {skillSaved && <span className="text-[11px] text-accent">✓ Saved</span>}
              </div>
            </div>
          )}

          {isWebSearch && onToolSettingsChange && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] text-text-muted m-0">
                🔎 Web Search uses a Brave Search API key:
              </p>
              <CredentialPicker
                schemaTypes={["webSearch"]}
                selectedCredentialId={toolSettings?.webSearchCredentialId ?? null}
                onSelect={(id) =>
                  onToolSettingsChange({
                    ...toolSettings,
                    webSearchCredentialId: id ?? undefined,
                  })
                }
                workspacePath={workspacePath || null}
              />
            </div>
          )}

          <div className="flex justify-between items-center mt-1">
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
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border-subtle bg-card px-3 py-1.5 text-xs font-semibold text-text-main hover:bg-card-hover cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
