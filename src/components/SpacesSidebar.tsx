import { useState, useEffect } from "react";
import { type SpaceEntry } from "@/types/workspace";
import { storage } from "@/services/storage";


interface SpacesSidebarProps {
  spaces: SpaceEntry[];
  activeSpaceId: string;
  onSwitchSpace: (spaceId: string) => void;
  onAddSpace: () => void;
  onRenameSpace: (spaceId: string, newLabel: string) => void;
  onBack: () => void;
  onSpaceContextMenu?: (spaceId: string, event: React.MouseEvent) => void;
  editingSpaceId?: string | null;
  setEditingSpaceId?: (id: string | null) => void;
  onOpenSettings: () => void;
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
  editingSpaceId,
  setEditingSpaceId,
  onOpenSettings,
}: SpacesSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const [width, setWidth] = useState(() => storage.getSidebarWidth(56));
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (editingSpaceId !== undefined) {
      setEditingId(editingSpaceId);
      if (editingSpaceId) {
        const space = spaces.find((s) => s.id === editingSpaceId);
        setEditValue(space ? space.label : "");
      }
    }
  }, [editingSpaceId, spaces]);

  const startRename = (space: SpaceEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(space.id);
    setEditValue(space.label);
    if (setEditingSpaceId) {
      setEditingSpaceId(space.id);
    }
  };

  const commitRename = () => {
    if (editingId === null) return;
    const trimmed = editValue.trim();
    if (trimmed) {
      onRenameSpace(editingId, trimmed);
    }
    setEditingId(null);
    if (setEditingSpaceId) {
      setEditingSpaceId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") {
      setEditingId(null);
      if (setEditingSpaceId) {
        setEditingSpaceId(null);
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleDoubleClick = () => {
    setWidth(56);
    storage.setSidebarWidth(56);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      const boundedWidth = Math.max(56, Math.min(newWidth, 380));
      setWidth(boundedWidth);
      storage.setSidebarWidth(boundedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  // Sort spaces by order
  const sortedSpaces = [...spaces].sort((a, b) => a.order - b.order);
  const isCompact = width <= 80;

  return (
    <div
      className={`relative flex flex-col py-4 bg-sidebar border-r border-border-subtle z-10 shrink-0 transition-all duration-75 ${
        isCompact ? "items-center gap-3" : "px-3 gap-3 select-none"
      }`}
      style={{ width: `${width}px` }}
      id="spaces-sidebar"
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        className="absolute top-0 bottom-0 right-0 w-1.5 -mr-0.75 cursor-col-resize select-none z-50 group"
        title="Double-click to reset width"
      >
        <div
          className={`absolute top-0 bottom-0 right-0.5 w-0.5 transition-colors duration-150 h-full ${
            isResizing
              ? "bg-accent shadow-[0_0_8px_rgba(212,230,0,0.8)]"
              : "bg-transparent group-hover:bg-accent-dim/60"
          }`}
        />
      </div>

      {/* Logo / Back button */}
      {isCompact ? (
        <button
          className="w-10 h-10 rounded-md flex items-center justify-center text-xl text-text-secondary hover:text-text-main hover:bg-card transition-colors cursor-pointer select-none border-none bg-transparent"
          onClick={onBack}
          title="Back to Dashboard"
        >
          🐝
        </button>
      ) : (
        <button
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-text-secondary hover:text-text-main hover:bg-card/50 transition-all cursor-pointer border-none bg-transparent select-none text-left self-start"
          onClick={onBack}
          title="Back to Dashboard"
        >
          <span className="text-xl">🐝</span>
          <span className="font-bold text-sm tracking-wider">HIVE</span>
        </button>
      )}

      {/* Space buttons */}
      <div className={`flex flex-col w-full ${isCompact ? "gap-2 items-center" : "gap-1.5"}`}>
        {sortedSpaces.map((space) => {
          const displayLabel = space.label.substring(0, 5).toUpperCase() || "S";
          
          if (isCompact) {
            // Calibrated dynamic text resizing for a slightly more compact, balanced fit in 40px box
            const fontClass =
              displayLabel.length > 4
                ? "text-[9px]"
                : displayLabel.length > 2
                ? "text-[11px]"
                : "text-[13.5px]";

            return (
              <button
                key={space.id}
                className={`w-10 h-10 rounded-md flex items-center justify-center font-bold cursor-pointer transition-all border ${
                  activeSpaceId === space.id
                    ? "text-primary bg-accent border-accent shadow-[0_0_12px_rgba(212,230,0,0.3)] hover:bg-accent-dim"
                    : "text-[#a5a5a5] border-white/20 bg-transparent hover:text-text-main hover:bg-card"
                }`}
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
                    className={`w-full text-center bg-transparent border-none outline-none text-inherit font-black uppercase tracking-tighter p-0 m-0 ${fontClass}`}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className={`${fontClass} tracking-tighter uppercase font-black`}>
                    {displayLabel}
                  </span>
                )}
              </button>
            );
          } else {
            // Calibrated dynamic text resizing for a slightly more compact, balanced fit in 28px avatar box
            const avatarFontClass =
              displayLabel.length > 4
                ? "text-[8px]"
                : displayLabel.length > 2
                ? "text-[9.5px]"
                : "text-[12px]";

            return (
              <button
                key={space.id}
                className={`w-full px-3 py-2 flex items-center gap-3 rounded-lg text-sm font-medium cursor-pointer transition-all border text-left min-w-0 ${
                  activeSpaceId === space.id
                    ? "text-accent bg-accent-glow/10 border-accent shadow-[0_0_12px_rgba(212,230,0,0.08)]"
                    : "text-[#a5a5a5] border-white/20 bg-transparent hover:text-text-main hover:bg-card/50"
                }`}
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
                {/* Space Icon/Avatar (Yellow Rounded Square when active) */}
                <div
                  className={`w-7 h-7 rounded-md flex items-center justify-center font-black uppercase shrink-0 border transition-all ${avatarFontClass} ${
                    activeSpaceId === space.id
                      ? "bg-accent text-primary border-accent"
                      : "bg-primary/30 text-[#b5b5b5] border-border-subtle"
                  }`}
                >
                  {displayLabel}
                </div>

                {/* Space Name */}
                {editingId === space.id ? (
                  <input
                    className="grow min-w-0 bg-transparent border-none outline-none text-[11.5px] tracking-wide text-text-main p-0 m-0"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="truncate grow text-[11.5px] tracking-wide">{space.label}</span>
                )}
              </button>
            );
          }
        })}
      </div>

      {/* Add space */}
      {isCompact ? (
        <button
          className="w-10 h-10 rounded-md flex items-center justify-center cursor-pointer transition-all border border-dashed border-white/20 bg-transparent text-xl font-normal text-text-muted hover:text-accent hover:border-accent/50 hover:bg-accent-glow/5"
          onClick={onAddSpace}
          title="Add new space"
          id="add-space-btn"
        >
          +
        </button>
      ) : (
        <button
          className="w-full px-3 py-2 flex items-center justify-center gap-2 rounded-lg cursor-pointer transition-all border border-dashed border-white/20 text-xs font-semibold bg-transparent text-text-muted hover:text-accent hover:border-accent/50 hover:bg-accent-glow/5"
          onClick={onAddSpace}
          title="Add new space"
          id="add-space-btn"
        >
          <span>+</span>
          <span>Add Space</span>
        </button>
      )}

      {/* Spacer pushing settings to bottom */}
      <div className="flex-grow" />

      {/* Settings Button */}
      {isCompact ? (
        <button
          className="w-10 h-10 rounded-md flex items-center justify-center cursor-pointer transition-all border border-border-subtle bg-transparent text-lg text-text-secondary hover:text-accent hover:border-accent-dim hover:bg-card select-none"
          onClick={onOpenSettings}
          title="Workspace Settings"
          id="sidebar-settings-btn"
        >
          ⚙️
        </button>
      ) : (
        <button
          className="w-full px-3 py-2 flex items-center gap-3 rounded-lg text-xs font-semibold cursor-pointer transition-all border border-border-subtle bg-transparent text-left text-text-secondary hover:text-accent hover:border-accent-dim hover:bg-card select-none"
          onClick={onOpenSettings}
          title="Workspace Settings"
          id="sidebar-settings-btn"
        >
          <span className="text-sm">⚙️</span>
          <span>Settings</span>
        </button>
      )}
    </div>
  );
}
