import { useState } from "react";

// ─── Types ───────────────────────────────────────────────────
export interface SpaceEntry {
  id: string;
  label: string;
  order: number;
}

interface SpacesSidebarProps {
  spaces: SpaceEntry[];
  activeSpaceId: string;
  onSwitchSpace: (spaceId: string) => void;
  onAddSpace: () => void;
  onRenameSpace: (spaceId: string, newLabel: string) => void;
  onBack: () => void;
  onSpaceContextMenu?: (spaceId: string, event: React.MouseEvent) => void;
}

// ─── Component ───────────────────────────────────────────────
export default function SpacesSidebar({
  spaces,
  activeSpaceId,
  onSwitchSpace,
  onAddSpace,
  onRenameSpace,
  onBack,
  onSpaceContextMenu,
}: SpacesSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startRename = (space: SpaceEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(space.id);
    setEditValue(space.label);
  };

  const commitRename = () => {
    if (editingId === null) return;
    const trimmed = editValue.trim();
    if (trimmed) {
      onRenameSpace(editingId, trimmed);
    }
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") setEditingId(null);
  };

  // Sort spaces by order
  const sortedSpaces = [...spaces].sort((a, b) => a.order - b.order);

  return (
    <div className="w-14 flex flex-col items-center py-4 bg-sidebar border-r border-border-subtle z-10 shrink-0 gap-6" id="spaces-sidebar">
      {/* Logo / Back button */}
      <button className="w-10 h-10 rounded-md flex items-center justify-center text-xl text-text-secondary hover:text-text-main hover:bg-card transition-colors cursor-pointer select-none mb-2 border-none bg-transparent" onClick={onBack} title="Back to Dashboard">
        🐝
      </button>

      {/* Space buttons */}
      <div className="flex flex-col gap-3 items-center w-full">
        {sortedSpaces.map((space) => (
          <button
            key={space.id}
            className={`w-10 h-10 rounded-md flex items-center justify-center text-xs font-bold cursor-pointer transition-all border ${activeSpaceId === space.id ? "text-primary bg-accent border-accent shadow-[0_0_12px_rgba(212,230,0,0.3)] hover:bg-accent-dim" : "text-text-muted border-transparent bg-transparent hover:text-text-main hover:bg-card"}`}
            onClick={() => onSwitchSpace(space.id)}
            onDoubleClick={(e) => startRename(space, e)}
            onContextMenu={(e) => {
              if (onSpaceContextMenu) {
                onSpaceContextMenu(space.id, e);
              }
            }}
            title={`Space: ${space.label} (double-click to rename)`}
            id={`space-${space.id}`}
          >
            {editingId === space.id ? (
              <input
                className="w-8 text-center bg-transparent border-none outline-none text-inherit font-inherit text-[10px] uppercase font-black tracking-wider"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={handleKeyDown}
                autoFocus
                maxLength={6}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              space.label
            )}
          </button>
        ))}
      </div>

      {/* Add space */}
      <button
        className="w-10 h-10 rounded-md flex items-center justify-center cursor-pointer transition-all border bg-transparent mt-4 text-xl font-normal text-text-muted border-transparent hover:text-accent hover:border-dashed hover:border-accent-dim hover:bg-[rgba(212,230,0,0.1)]"
        onClick={onAddSpace}
        title="Add new space"
        id="add-space-btn"
      >
        +
      </button>
    </div>
  );
}
