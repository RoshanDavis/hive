import { useState, useMemo } from "react";
import { type NodeDefinition } from "@/nodes/types";
import { NODE_REGISTRY } from "@/nodes/registry";
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

  const filteredNodes = useMemo(() => {
    const baseList = NODE_REGISTRY.filter((d) => d.type !== "output");
    const query = searchQuery.trim().toLowerCase();
    if (!query) return baseList;

    return baseList
      .map((def) => {
        const label = def.label.toLowerCase();
        const desc = def.description.toLowerCase();

        let score = 0;
        if (label === query) score = 100;
        else if (label.startsWith(query)) score = 80;
        else if (label.includes(query)) score = 60;
        else if (desc.includes(query)) score = 40;

        return { def, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.def);
  }, [searchQuery]);

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

      {visibleCount > 0 ? (
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
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center text-text-muted gap-1.5 py-4">
          <span className="text-xl opacity-50">🔍</span>
          <span className="text-xs">No nodes match "{searchQuery}"</span>
        </div>
      )}
    </CollapsibleSection>
  );
}
