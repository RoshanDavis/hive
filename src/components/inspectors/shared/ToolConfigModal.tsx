import { useEffect } from "react";
import type { ToolDef } from "@/services/api";
import type { AgentToolSettings } from "@/nodes/types";
import { type ToolCategory } from "@/services/toolsService";
import { categoryIcon } from "@/services/builtInTools";
import CredentialPicker from "./CredentialPicker";

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
