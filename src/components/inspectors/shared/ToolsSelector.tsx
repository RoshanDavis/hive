import { useCallback, useEffect, useState } from "react";
import type { ToolDef } from "@/services/api";
import { toolsService, type ToolCategory } from "@/services/toolsService";
import { formLabelClass, formInputClass } from "@/components/shared/FormField";

export interface ToolsSelection {
  native: string[];
  mcp: string[];
  skills: string[];
}

const CATEGORIES: { key: ToolCategory; title: string; icon: string; addPlaceholder: string }[] = [
  { key: "native", title: "Native Tools", icon: "🔧", addPlaceholder: "New native tool name" },
  { key: "mcp", title: "MCP Servers", icon: "🔌", addPlaceholder: "New MCP server name" },
  { key: "skills", title: "Skills", icon: "✨", addPlaceholder: "New skill name" },
];

function slugify(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "tool"
  );
}

interface ToolsSelectorProps {
  value: ToolsSelection;
  onChange: (next: ToolsSelection) => void;
  workspacePath: string;
}

/**
 * Multi-select picker for an Agent's / Tools node's native tools, MCP servers,
 * and skills. Lists built-in + user tools (toolsService), supports adding a
 * workspace-scoped custom tool and removing user tools. Selection only — runtime
 * invocation is deferred (see docs/agent-node.md).
 */
export default function ToolsSelector({ value, onChange, workspacePath }: ToolsSelectorProps) {
  const [available, setAvailable] = useState<Record<ToolCategory, ToolDef[]>>({
    native: [],
    mcp: [],
    skills: [],
  });
  const [draft, setDraft] = useState<Record<ToolCategory, string>>({
    native: "",
    mcp: "",
    skills: "",
  });

  const reload = useCallback(async () => {
    const [native, mcp, skills] = await Promise.all([
      toolsService.getAvailable("native", workspacePath),
      toolsService.getAvailable("mcp", workspacePath),
      toolsService.getAvailable("skills", workspacePath),
    ]);
    setAvailable({ native, mcp, skills });
  }, [workspacePath]);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggle = (category: ToolCategory, id: string) => {
    const selected = value[category];
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    onChange({ ...value, [category]: next });
  };

  const handleAdd = async (category: ToolCategory) => {
    const label = draft[category].trim();
    if (!label) return;
    const id = slugify(label);
    await toolsService.addTool("workspace", category, { id, label }, workspacePath);
    setDraft((d) => ({ ...d, [category]: "" }));
    await reload();
    if (!value[category].includes(id)) {
      onChange({ ...value, [category]: [...value[category], id] });
    }
  };

  const handleRemove = async (category: ToolCategory, id: string) => {
    await toolsService.removeTool(category, id, workspacePath);
    if (value[category].includes(id)) {
      onChange({ ...value, [category]: value[category].filter((x) => x !== id) });
    }
    await reload();
  };

  return (
    <div className="flex flex-col gap-4">
      {CATEGORIES.map(({ key, title, icon, addPlaceholder }) => {
        const items = available[key];
        const selected = value[key];
        return (
          <div key={key} className="flex flex-col gap-2">
            <span className={formLabelClass}>
              {icon} {title}
              {selected.length > 0 ? ` (${selected.length})` : ""}
            </span>

            {items.length === 0 ? (
              <p className="text-[11px] text-text-muted m-0">None available. Add one below.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {items.map((t) => {
                  const checked = selected.includes(t.id);
                  const builtIn = toolsService.isBuiltIn(key, t.id);
                  return (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 rounded-md border border-border-subtle bg-card/40 px-2 py-1.5"
                    >
                      <input
                        id={`tool-${key}-${t.id}`}
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(key, t.id)}
                        className="cursor-pointer accent-[var(--accent)]"
                      />
                      <label
                        htmlFor={`tool-${key}-${t.id}`}
                        className="flex-1 min-w-0 cursor-pointer"
                        title={t.description}
                      >
                        <span className="text-xs text-text-main truncate block">{t.label}</span>
                      </label>
                      {!builtIn && (
                        <button
                          type="button"
                          onClick={() => handleRemove(key, t.id)}
                          className="shrink-0 text-[11px] text-text-muted hover:text-danger transition-colors cursor-pointer border-none bg-transparent"
                          title="Remove this tool"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex gap-2">
              <input
                className={formInputClass}
                type="text"
                value={draft[key]}
                placeholder={addPlaceholder}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleAdd(key);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => void handleAdd(key)}
                disabled={!draft[key].trim()}
                className="shrink-0 rounded-md border border-border-subtle bg-card px-3 text-xs font-semibold text-text-main enabled:cursor-pointer enabled:hover:bg-card-hover disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
