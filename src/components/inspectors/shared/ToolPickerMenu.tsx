import { useCallback, useEffect, useMemo, useState } from "react";
import type { ToolDef } from "@/services/api";
import { toolsService, type ToolCategory } from "@/services/toolsService";
import { categoryIcon } from "@/services/builtInTools";
import { rankedSearch } from "@/utils/rankedSearch";
import { formInputClass } from "@/components/shared/FormField";

interface ToolPickerMenuProps {
  category: ToolCategory;
  workspacePath: string;
  /** Tool ids already selected (hidden from the list). */
  excludeIds: string[];
  onPick: (id: string) => void;
  onCreateNew: () => void;
  onClose: () => void;
}

const TITLES: Record<ToolCategory, string> = {
  native: "Add a native tool",
  mcp: "Add an MCP server",
  skills: "Add a skill",
};

/** Popup searchable list of available tools for one category, mirroring
 * NodePickerMenu. Lists built-in ⊕ user tools (minus already-selected ones),
 * lets the user delete their own tools, and offers a "Create new" action. */
export default function ToolPickerMenu({
  category,
  workspacePath,
  excludeIds,
  onPick,
  onCreateNew,
  onClose,
}: ToolPickerMenuProps) {
  const [query, setQuery] = useState("");
  const [all, setAll] = useState<ToolDef[]>([]);

  const reload = useCallback(async () => {
    setAll(await toolsService.getAvailable(category, workspacePath));
  }, [category, workspacePath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Close on Escape for keyboard parity with the backdrop click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const available = useMemo(() => {
    const excluded = new Set(excludeIds);
    return all.filter((t) => !excluded.has(t.id));
  }, [all, excludeIds]);

  const results = useMemo(
    () =>
      rankedSearch(available, query, {
        primary: (t) => t.label,
        secondary: [
          { value: (t) => t.id, score: 50 },
          { value: (t) => t.description ?? "", score: 40 },
        ],
      }),
    [available, query]
  );

  const handleDelete = async (id: string) => {
    await toolsService.removeTool(category, id, workspacePath);
    await reload();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border-subtle rounded-xl shadow-card-hover w-full max-w-md max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <span className="text-sm font-bold text-text-main">{TITLES[category]}</span>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-main text-xl cursor-pointer border-none bg-transparent w-7 h-7 flex items-center justify-center rounded-md hover:bg-card-hover"
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-3">
          <input
            autoFocus
            className={formInputClass}
            type="text"
            placeholder="Search tools..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3">
          {available.length === 0 ? (
            <div className="text-[12px] text-text-muted py-6 text-center">
              No tools available — create your own below.
            </div>
          ) : results.length === 0 ? (
            <div className="text-[12px] text-text-muted py-6 text-center">
              No tools match "{query}"
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {results.map((t) => {
                const builtIn = toolsService.isBuiltIn(category, t.id);
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 bg-transparent hover:bg-card-hover border border-transparent hover:border-border-subtle rounded-md px-2.5 py-2 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => onPick(t.id)}
                      className="flex items-center gap-3 flex-1 min-w-0 bg-transparent border-none cursor-pointer text-left"
                      title={t.description}
                    >
                      <span className="text-xl">{t.icon || categoryIcon(category)}</span>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold text-text-main">{t.label}</span>
                        {t.description && (
                          <span className="text-[11px] text-text-muted truncate">
                            {t.description}
                          </span>
                        )}
                      </div>
                    </button>
                    {builtIn ? (
                      <span className="shrink-0 text-[10px] text-text-muted uppercase tracking-wide">
                        Built-in
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleDelete(t.id)}
                        className="shrink-0 text-text-muted hover:text-danger transition-colors cursor-pointer border-none bg-transparent w-6 h-6 flex items-center justify-center rounded-md hover:bg-danger/10"
                        title="Delete this tool from the registry"
                      >
                        🗑
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Create new */}
        <div className="px-4 py-3 border-t border-border-subtle">
          <button
            type="button"
            onClick={onCreateNew}
            className="w-full flex items-center justify-center gap-2 rounded-md border border-dashed border-border-card text-text-secondary hover:text-text-main hover:bg-card-hover py-2 text-sm font-medium cursor-pointer transition-colors"
          >
            <span className="text-base">＋</span>
            <span>Create your own</span>
          </button>
        </div>
      </div>
    </div>
  );
}
