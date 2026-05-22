import { useState, useMemo, useEffect } from "react";
import type { Node, Edge } from "@xyflow/react";
import { NODE_REGISTRY, type NodeDefinition } from "../nodes/types";
import { getConnectionBehavior } from "../engine/connectivity";

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
  selectedEdge: Edge | null;
  onUpdateEdgeData?: (edgeId: string, edgeType: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
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
  selectedEdge,
  onUpdateEdgeData,
  onDeleteEdge,
}: InspectorPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem("hive-inspector-width");
    return saved ? parseInt(saved, 10) : 320;
  });
  const [isResizing, setIsResizing] = useState(false);

  const sourceNode = useMemo(() => {
    if (!selectedEdge || !nodes) return null;
    return nodes.find((n) => n.id === selectedEdge.source) || null;
  }, [selectedEdge, nodes]);

  const targetNode = useMemo(() => {
    if (!selectedEdge || !nodes) return null;
    return nodes.find((n) => n.id === selectedEdge.target) || null;
  }, [selectedEdge, nodes]);

  const connectionBehavior = useMemo(() => {
    if (!sourceNode || !targetNode) {
      return { allowedOption: "one-way" as const, defaultFlow: "one-way" as const };
    }
    return getConnectionBehavior(
      sourceNode.type,
      targetNode.type,
      selectedEdge?.sourceHandle,
      selectedEdge?.targetHandle
    );
  }, [sourceNode, targetNode, selectedEdge]);

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

  const filteredNodes = useMemo(() => {
    const baseList = NODE_REGISTRY.filter(d => d.type !== "output");
    const query = searchQuery.trim().toLowerCase();
    if (!query) return baseList;

    return baseList.map((def) => {
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
              {selectedNode.type === "output" || selectedNode.type === "outputNode" ? "📤" : ""}
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
      ) : selectedEdge ? (
        <>
          <div className="p-4 border-b border-border-subtle bg-card flex flex-col gap-1">
            <h2 className="text-base font-semibold m-0 text-text-main flex items-center gap-2">
              🔗 Connection
            </h2>
            <span className="text-[10px] uppercase tracking-widest font-bold text-accent bg-accent-glow self-start px-2 py-0.5 rounded-sm">
              Inspector
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
            {/* Source & Target Routing Info */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Routing</label>
              
              <div className="bg-primary/20 border border-border-subtle rounded-lg p-3 flex flex-col gap-3 relative overflow-hidden">
                <div className="flex items-center justify-between gap-3 z-10">
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[10px] uppercase tracking-widest text-text-muted font-bold">Source</span>
                    <span className="text-sm font-semibold text-text-main truncate mt-0.5" title={sourceNode ? String(sourceNode.data?.label || sourceNode.type) : "Source Node"}>
                      {sourceNode ? String(sourceNode.data?.label || sourceNode.type) : "Source Node"}
                    </span>
                    <span className="text-[9px] font-mono text-text-muted truncate mt-0.5">ID: {selectedEdge.source}</span>
                  </div>
                  
                  <div className="text-accent flex items-center justify-center shrink-0 px-1">
                    <span className="text-lg leading-none select-none animate-pulse">➔</span>
                  </div>
                  
                  <div className="flex flex-col min-w-0 flex-1 text-right">
                    <span className="text-[10px] uppercase tracking-widest text-text-muted font-bold">Target</span>
                    <span className="text-sm font-semibold text-text-main truncate mt-0.5" title={targetNode ? String(targetNode.data?.label || targetNode.type) : "Target Node"}>
                      {targetNode ? String(targetNode.data?.label || targetNode.type) : "Target Node"}
                    </span>
                    <span className="text-[9px] font-mono text-text-muted truncate mt-0.5">ID: {selectedEdge.target}</span>
                  </div>
                </div>
              </div>
            </div>

             {/* Edge Type Customization */}
            <div className="flex flex-col gap-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {["database", "database-read", "database-write"].includes(connectionBehavior.allowedOption)
                  ? "Database Permissions"
                  : "Connection Type"}
              </label>
              <div className="flex flex-col gap-2">
                {["database", "database-read", "database-write"].includes(connectionBehavior.allowedOption) ? (
                  [
                    {
                      id: "write-only",
                      label: "Write-Only",
                      desc: "Allows the node to save output payloads directly into database records.",
                      icon: "💾",
                    },
                    {
                      id: "read-only",
                      label: "Read-Only",
                      desc: "Allows the node to query records from the database as input context.",
                      icon: "⚡",
                    },
                    {
                      id: "read-write",
                      label: "Read & Write Sync",
                      desc: "Maintains full two-way synchronization between the node and storage.",
                      icon: "🔄",
                    },
                  ]
                    .filter((t) => {
                      if (connectionBehavior.allowedOption === "database-read") {
                        return t.id === "read-only";
                      }
                      if (connectionBehavior.allowedOption === "database-write") {
                        return t.id === "write-only";
                      }
                      return true;
                    })
                    .map((t) => {
                      const isSelected = (selectedEdge.data?.edgeType || "read-write") === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => onUpdateEdgeData?.(selectedEdge.id, t.id)}
                          className={`flex items-start text-left gap-3 p-3 rounded-lg border text-sm transition-all duration-150 cursor-pointer ${
                            isSelected
                              ? "bg-[#38bdf8]/10 border-[#38bdf8] text-text-main shadow-[0_0_12px_rgba(56,189,248,0.15)]"
                              : "bg-card border-border-card text-text-muted hover:bg-card-hover hover:border-border-subtle"
                          }`}
                        >
                          <span className="text-base mt-0.5 select-none">{t.icon}</span>
                          <div className="flex flex-col min-w-0 flex-grow">
                            <span className={`font-semibold ${isSelected ? "text-[#38bdf8]" : "text-text-main"}`}>
                              {t.label}
                            </span>
                            <span className="text-xs text-text-muted mt-1 leading-normal font-normal">
                              {t.desc}
                            </span>
                          </div>
                        </button>
                      );
                    })
                ) : (
                  [
                    {
                      id: "one-way",
                      label: "One-Way Flow",
                      desc: "Dashed line with a moving forward flow animation. Standard trigger and sequential logic.",
                      icon: "⚡",
                    },
                    {
                      id: "bi-directional",
                      label: "Bi-directional Sync",
                      desc: "Dual arrowheads with two dashed flow animations moving in both directions. Ideal for databases and storage sync.",
                      icon: "🔄",
                    },
                  ]
                    .filter((t) => {
                      if (connectionBehavior.allowedOption === "one-way") {
                        return t.id === "one-way";
                      }
                      if (connectionBehavior.allowedOption === "bi-directional") {
                        return t.id === "bi-directional";
                      }
                      return true;
                    })
                    .map((t) => {
                      const isSelected = (selectedEdge.data?.edgeType || "one-way") === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => onUpdateEdgeData?.(selectedEdge.id, t.id)}
                          className={`flex items-start text-left gap-3 p-3 rounded-lg border text-sm transition-all duration-150 cursor-pointer ${
                            isSelected
                              ? "bg-accent-glow/10 border-accent text-text-main shadow-[0_0_12px_rgba(212,230,0,0.08)]"
                              : "bg-card border-border-card text-text-muted hover:bg-card-hover hover:border-border-subtle"
                          }`}
                        >
                          <span className="text-base mt-0.5 select-none">{t.icon}</span>
                          <div className="flex flex-col min-w-0">
                            <span className={`font-semibold ${isSelected ? "text-accent" : "text-text-main"}`}>
                              {t.label}
                            </span>
                            <span className="text-xs text-text-muted mt-1 leading-normal font-normal">
                              {t.desc}
                            </span>
                          </div>
                        </button>
                      );
                    })
                )}
              </div>
              {connectionBehavior.allowedOption !== "both" && (
                <div className="text-[10px] text-text-muted italic px-1">
                  ℹ️ Flow and permissions are determined based on node connection type.
                </div>
              )}
            </div>

            {/* Delete Connection */}
            <div className="mt-auto border-t border-border-subtle pt-4">
              <button
                type="button"
                onClick={() => onDeleteEdge?.(selectedEdge.id)}
                className="w-full bg-red-950/20 hover:bg-red-900/40 border border-red-500/20 hover:border-red-500/40 text-red-400 hover:text-red-300 rounded-md py-2.5 px-4 text-sm font-medium transition-all flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer"
              >
                <span>🗑️</span>
                <span>Delete Connection</span>
              </button>
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
