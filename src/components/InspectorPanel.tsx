import { useState, useMemo, useEffect } from "react";
import type { Node, Edge } from "@xyflow/react";
import { NODE_REGISTRY, type NodeDefinition } from "../nodes/types";

// ─── Props ───────────────────────────────────────────────────
interface InspectorPanelProps {
  selectedNode: Node | null;
  onAddNode: (definition: NodeDefinition) => void;
  onUpdateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  onRunWorkflow: (triggerNodeId?: string) => void;
  onChatSend?: (nodeId: string, text: string) => void;
  isRunning: boolean;
  nodes?: Node[];
  edges?: Edge[];
  onDragStartNode?: (type: string) => void;
  onDragEndNode?: () => void;
}

// ─── Inspector Panel ─────────────────────────────────────────
export default function InspectorPanel({
  selectedNode,
  onAddNode,
  onUpdateNodeData,
  onRunWorkflow,
  onChatSend,
  isRunning,
  nodes,
  edges,
  onDragStartNode,
  onDragEndNode,
}: InspectorPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem("hive-inspector-width");
    return saved ? parseInt(saved, 10) : 320;
  });
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleDoubleClick = () => {
    setWidth(320);
    localStorage.setItem("hive-inspector-width", "320");
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Inspector is docked to the right edge, so width grows as mouse moves left (smaller clientX)
      const newWidth = window.innerWidth - e.clientX;
      const boundedWidth = Math.max(280, Math.min(newWidth, 800));
      setWidth(boundedWidth);
      localStorage.setItem("hive-inspector-width", String(boundedWidth));
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

  const handleDragStart = (event: React.DragEvent, nodeType: string) => {
    if (event.dataTransfer) {
      event.dataTransfer.setData("application/reactflow", nodeType);
      event.dataTransfer.effectAllowed = "move";

      // Hide the browser's default semi-transparent drag ghost image completely
      const img = new Image();
      img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      event.dataTransfer.setDragImage(img, 0, 0);
    }
    if (onDragStartNode) {
      onDragStartNode(nodeType);
    }
  };

  // Filter and rank node registry by search query
  const filteredNodes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return NODE_REGISTRY;

    return NODE_REGISTRY.map((def) => {
      const label = def.label.toLowerCase();
      const desc = def.description.toLowerCase();

      let score = 0;
      if (label === query) {
        score = 100; // Exact match
      } else if (label.startsWith(query)) {
        score = 80; // Prefix match
      } else if (label.includes(query)) {
        score = 60; // Substring match in label
      } else if (desc.includes(query)) {
        score = 40; // Substring match in description
      }

      return { def, score };
    })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.def);
  }, [searchQuery]);

  return (
    <div
      className="relative bg-sidebar border-l border-border-subtle flex flex-col z-10 shrink-0"
      id="inspector-panel"
      style={{ width: `${width}px` }}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        className="absolute top-0 bottom-0 left-0 w-1.5 -ml-[3px] cursor-col-resize select-none z-50 group"
        title="Double-click to reset width"
      >
        <div
          className={`absolute top-0 bottom-0 left-[2px] w-[2px] transition-colors duration-150 h-full ${
            isResizing
              ? "bg-accent shadow-[0_0_8px_rgba(212,230,0,0.8)]"
              : "bg-transparent group-hover:bg-accent-dim/60"
          }`}
        />
      </div>

      {selectedNode ? (
        <>
          <div className="p-4 border-b border-border-subtle bg-card flex flex-col gap-1">
            <h2 className="text-base font-semibold m-0 text-text-main flex items-center gap-2">
              {selectedNode.type === "trigger" ? "⚡" : ""}
              {selectedNode.type === "notify" ? "🔔" : ""}
              {selectedNode.type === "ollama" ? "🤖" : ""}
              {selectedNode.type === "chat" ? "💬" : ""}
              {selectedNode.type === "output" ? "📤" : ""}
              {selectedNode.type === "jsonStorage" ? "💾" : ""}
              {" "}
              {String(selectedNode.data?.label || selectedNode.type)}
            </h2>
            <span className="text-[10px] uppercase tracking-widest font-bold text-accent bg-accent-glow self-start px-2 py-0.5 rounded-sm">{selectedNode.type}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
            {/* Common fields */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Label</label>
              <input
                className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
                type="text"
                value={String(selectedNode.data?.label || "")}
                onChange={(e) =>
                  onUpdateNodeData(selectedNode.id, {
                    ...selectedNode.data,
                    label: e.target.value,
                  })
                }
              />
            </div>

            {/* Dynamic Component Rendering based on Registry */}
            {(() => {
              const def = NODE_REGISTRY.find(d => d.type === selectedNode.type);
              const Inspector = def?.inspector;
              if (Inspector) {
                return (
                  <Inspector
                    node={selectedNode}
                    onUpdate={onUpdateNodeData}
                    isRunning={isRunning}
                    onRun={onRunWorkflow}
                    onChatSend={onChatSend}
                    nodes={nodes}
                    edges={edges}
                  />
                );
              }
              return null;
            })()}

            {/* Position info */}
            <div className="border-t border-border-subtle pt-4 flex flex-col gap-2">
              <div className="text-[11px] uppercase tracking-widest font-bold text-text-muted mb-1">Position</div>
              <div className="flex gap-4 text-sm text-text-main font-mono">
                <span>X: {Math.round(selectedNode.position?.x || 0)}</span>
                <span>Y: {Math.round(selectedNode.position?.y || 0)}</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="p-4 border-b border-border-subtle bg-card flex flex-col gap-1">
            <h2 className="text-base font-semibold m-0 text-text-main flex items-center gap-2">Add Node</h2>
            <span className="text-[10px] uppercase tracking-widest font-bold text-accent bg-accent-glow self-start px-2 py-0.5 rounded-sm">Palette</span>
          </div>

          <div className="p-4 border-b border-border-subtle bg-primary">
            <input
              className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
              type="text"
              placeholder="Search nodes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
            {filteredNodes.length > 0 ? (
              filteredNodes.map((def) => (
                <div
                  key={def.type}
                  className="bg-card border border-border-card rounded-lg p-4 cursor-grab active:cursor-grabbing transition-all hover:bg-card-hover hover:border-accent-dim hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
                  onClick={() => onAddNode(def)}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, def.type)}
                  onDragEnd={() => {
                    if (onDragEndNode) onDragEndNode();
                  }}
                  id={`add-node-${def.type}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">{def.icon}</span>
                    <span className="font-semibold text-text-main">{def.label}</span>
                  </div>
                  <div className="text-xs text-text-muted leading-relaxed">
                    {def.description}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 text-text-muted gap-2 mt-8">
                <span className="text-2xl opacity-50">🔍</span>
                <span className="text-sm">
                  No nodes match "{searchQuery}"
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
