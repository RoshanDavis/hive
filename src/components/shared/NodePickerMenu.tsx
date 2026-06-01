import { useEffect, useMemo, useState } from "react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { rankedSearch } from "@/utils/rankedSearch";
import { formInputClass } from "@/components/shared/FormField";
import { useTheme } from "@/contexts/ThemeContext";

interface NodePickerMenuProps {
  /** Plugin types to hide from the list (e.g. ones already added). */
  exclude?: string[];
  onPick: (type: string) => void;
  onClose: () => void;
  /** Popup heading. */
  title?: string;
}

/** Popup searchable list of node types, reusing the shared ranked search. */
export default function NodePickerMenu({
  exclude = [],
  onPick,
  onClose,
  title = "Add a node to override",
}: NodePickerMenuProps) {
  const [query, setQuery] = useState("");
  const theme = useTheme();

  // Close on Escape for keyboard parity with the backdrop click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const available = useMemo(() => {
    const excluded = new Set(exclude);
    return pluginRegistry.getAll().filter((p) => !excluded.has(p.type));
  }, [exclude]);

  const results = useMemo(
    () =>
      rankedSearch(available, query, {
        primary: (p) => p.meta.label,
        secondary: [
          { value: (p) => p.type, score: 50 },
          { value: (p) => p.meta.description, score: 40 },
        ],
      }),
    [available, query]
  );

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border-subtle rounded-xl shadow-card-hover w-full max-w-md max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <span className="text-sm font-bold text-text-main">{title}</span>
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
            placeholder="Search nodes to add..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3">
          {available.length === 0 ? (
            <div className="text-[12px] text-text-muted py-6 text-center">
              All nodes already have workspace overrides.
            </div>
          ) : results.length === 0 ? (
            <div className="text-[12px] text-text-muted py-6 text-center">
              No nodes match "{query}"
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {results.map((p) => (
                <button
                  key={p.type}
                  type="button"
                  onClick={() => onPick(p.type)}
                  className="flex items-center gap-3 bg-transparent hover:bg-card-hover border border-transparent hover:border-border-subtle rounded-md px-2.5 py-2 cursor-pointer text-left transition-colors"
                  title={p.meta.description}
                >
                  <span
                    className="text-xl"
                    style={{ filter: `drop-shadow(0 0 5px ${theme.accents.primary}55)` }}
                  >
                    {p.meta.icon}
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold text-text-main">{p.meta.label}</span>
                    <span className="text-[11px] text-text-muted truncate">
                      {p.meta.description}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
