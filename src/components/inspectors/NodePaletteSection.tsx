import { useState, useMemo } from "react";
import { type NodeDefinition } from "@/nodes/types";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { useRegistryVersion } from "@/hooks/useRegistryVersion";
import { rankedSearch } from "@/utils/rankedSearch";
import CollapsibleSection from "./CollapsibleSection";
import { formInputClass } from "@/components/shared/FormField";

interface NodePaletteSectionProps {
  onAddNode: (definition: NodeDefinition) => void;
  onDragStartNode?: (type: string) => void;
  onDragEndNode?: () => void;
  /** Opens the custom-node authoring modal. Omitted = the "+" stub is inert. */
  onCreateCustom?: () => void;
}

export default function NodePaletteSection({
  onAddNode,
  onDragStartNode,
  onDragEndNode,
  onCreateCustom,
}: NodePaletteSectionProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const registryVersion = useRegistryVersion();

  const filteredNodes = useMemo(
    () =>
      rankedSearch(pluginRegistry.getNodeDefinitions(), searchQuery, {
        primary: (def) => def.label,
        secondary: [{ value: (def) => def.description, score: 40 }],
      }),
    [searchQuery, registryVersion]
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
          className={formInputClass}
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

        {/* Add custom node. Stays present regardless of search matches. */}
        <div
          className="node-palette-card"
          style={{ borderStyle: "dashed", cursor: "pointer" }}
          onClick={() => onCreateCustom?.()}
          title="Create a custom node"
          id="add-custom-node"
        >
          <span className="text-2xl text-text-secondary select-none">＋</span>
          <span className="text-[11px] font-semibold text-text-muted text-center leading-tight w-full overflow-hidden text-ellipsis whitespace-nowrap">
            Custom
          </span>
        </div>
      </div>
    </CollapsibleSection>
  );
}
