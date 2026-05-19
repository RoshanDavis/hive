import { useState } from "react";

interface Space {
  id: number;
  label: string;
}

interface SpacesSidebarProps {
  workspaceName: string;
  onBack: () => void;
}

export default function SpacesSidebar({ workspaceName: _workspaceName, onBack }: SpacesSidebarProps) {
  const [spaces, setSpaces] = useState<Space[]>([{ id: 1, label: "1" }]);
  const [activeSpace, setActiveSpace] = useState(1);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  const addSpace = () => {
    const nextId = spaces.length > 0 ? Math.max(...spaces.map((s) => s.id)) + 1 : 1;
    const newSpace: Space = { id: nextId, label: String(nextId) };
    setSpaces((prev) => [...prev, newSpace]);
    setActiveSpace(nextId);
  };

  const startRename = (space: Space, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(space.id);
    setEditValue(space.label);
  };

  const commitRename = () => {
    if (editingId === null) return;
    const trimmed = editValue.trim();
    if (trimmed) {
      setSpaces((prev) =>
        prev.map((s) => (s.id === editingId ? { ...s, label: trimmed } : s))
      );
    }
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") setEditingId(null);
  };

  return (
    <div className="spaces-sidebar" id="spaces-sidebar">
      {/* Logo / Back button */}
      <button className="spaces-logo" onClick={onBack} title="Back to Dashboard">
        🐝
      </button>

      {/* Space buttons */}
      <div className="spaces-list">
        {spaces.map((space) => (
          <button
            key={space.id}
            className={`space-btn ${activeSpace === space.id ? "active" : ""}`}
            onClick={() => setActiveSpace(space.id)}
            onDoubleClick={(e) => startRename(space, e)}
            title={`Space: ${space.label} (double-click to rename)`}
            id={`space-${space.id}`}
          >
            {editingId === space.id ? (
              <input
                className="space-rename-input"
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
        className="space-btn space-add"
        onClick={addSpace}
        title="Add new space"
        id="add-space-btn"
      >
        +
      </button>
    </div>
  );
}
