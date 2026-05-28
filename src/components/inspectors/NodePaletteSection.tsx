import { useState, useMemo, useEffect } from "react";
import { type NodeDefinition } from "@/nodes/types";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { rankedSearch } from "@/utils/rankedSearch";
import CollapsibleSection from "./CollapsibleSection";

interface NodePaletteSectionProps {
  onAddNode: (definition: NodeDefinition) => void;
  onDragStartNode?: (type: string) => void;
  onDragEndNode?: () => void;
}

export default function NodePaletteSection({
  onAddNode,
  onDragStartNode,
  onDragEndNode,
}: NodePaletteSectionProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showComingSoon, setShowComingSoon] = useState(false);

  // Auto-dismiss the "coming soon" hint after a moment.
  useEffect(() => {
    if (!showComingSoon) return;
    const t = setTimeout(() => setShowComingSoon(false), 2500);
    return () => clearTimeout(t);
  }, [showComingSoon]);

  const filteredNodes = useMemo(
    () =>
      rankedSearch(pluginRegistry.getNodeDefinitions(), searchQuery, {
        primary: (def) => def.label,
        secondary: [{ value: (def) => def.description, score: 40 }],
      }),
    [searchQuery]
  );

  const handleDragStart = (event: React.DragEvent, nodeType: string) => {
    if (event.dataTransfer) {
      event.dataTransfer.setData("application/reactflow", nodeType);
      event.dataTransfer.effectAllowed = "move";

      const img = new Image();
      img.src =
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      event.dataTransfer.setDragImage(img, 0, 0);
    }
    onDragStartNode?.(nodeType);
  };

  const visibleCount = filteredNodes.length;

  return (
    <CollapsibleSection
      title="Nodes"
      icon="🧩"
      defaultOpen={true}
      badge={visibleCount}
    >
      <div className="mb-3">
        <input
          className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
          type="text"
          placeholder="Search nodes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* No-match hint — the grid (with its add-custom card) still renders below */}
      {visibleCount === 0 && searchQuery.trim() !== "" && (
        <div className="flex items-center justify-center text-text-muted gap-1.5 py-2 mb-1">
          <span className="text-sm opacity-50">🔍</span>
          <span className="text-xs">No nodes match "{searchQuery}"</span>
        </div>
      )}

      <div className="node-palette-grid">
        {filteredNodes.map((def) => (
          <div
            key={def.type}
            className="node-palette-card"
            onClick={() => onAddNode(def)}
            draggable={true}
            onDragStart={(e) => handleDragStart(e, def.type)}
            onDragEnd={() => onDragEndNode?.()}
            title={def.description}
            id={`add-node-${def.type}`}
          >
            <span className="text-2xl select-none">{def.icon}</span>
            <span className="text-[11px] font-semibold text-text-main text-center leading-tight w-full overflow-hidden text-ellipsis whitespace-nowrap">
              {def.label}
            </span>
          </div>
        ))}

        {/* Add custom node — stub. Stays present regardless of search matches. */}
        <div
          className="node-palette-card"
          style={{ borderStyle: "dashed", cursor: "pointer" }}
          onClick={() => setShowComingSoon(true)}
          title="Create a custom node (coming soon)"
          id="add-custom-node"
        >
          <span className="text-2xl text-text-secondary select-none">＋</span>
          <span className="text-[11px] font-semibold text-text-muted text-center leading-tight w-full overflow-hidden text-ellipsis whitespace-nowrap">
            Custom
          </span>
        </div>
      </div>

      {showComingSoon && (
        <div className="mt-2 text-[11px] text-text-muted bg-accent-glow/40 border border-accent-dim/40 rounded-md px-2.5 py-1.5 animate-[fadeIn_0.15s_ease-out]">
          ✨ Custom nodes are coming soon.
        </div>
      )}
    </CollapsibleSection>
  );
}
