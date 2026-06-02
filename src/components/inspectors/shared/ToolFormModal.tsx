import { useEffect, useState } from "react";
import { toolsService, type ToolCategory, type ToolsScope } from "@/services/toolsService";
import { categoryIcon } from "@/services/builtInTools";
import { slugify } from "@/utils/slugify";
import { formInputClass, formLabelClass } from "@/components/shared/FormField";

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

/** Minimal create-form for a user tool / MCP server / skill: name, description,
 * icon, and scope. Persists via toolsService.addTool, then selects it. Runtime
 * for user-created entries is deferred — they show a "not runnable yet" badge on
 * their card until their category's execution lands. */
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = async () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Name is required.");
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
        },
        workspacePath
      );
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
        className="bg-card border border-border-subtle rounded-xl shadow-card-hover w-full max-w-md flex flex-col"
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

        <div className="flex flex-col gap-3 px-4 py-4">
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

          <div className="flex flex-col gap-1">
            <label className={formLabelClass}>Scope</label>
            <div className="flex gap-2">
              {workspacePath && (
                <button
                  type="button"
                  onClick={() => setScope("workspace")}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                    scope === "workspace"
                      ? "border-accent bg-accent-glow text-accent"
                      : "border-border-subtle bg-card text-text-secondary hover:bg-card-hover"
                  }`}
                >
                  📁 Workspace
                </button>
              )}
              <button
                type="button"
                onClick={() => setScope("global")}
                className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                  scope === "global"
                    ? "border-accent bg-accent-glow text-accent"
                    : "border-border-subtle bg-card text-text-secondary hover:bg-card-hover"
                }`}
              >
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
