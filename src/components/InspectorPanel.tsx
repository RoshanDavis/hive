import { useState, useMemo, useEffect } from "react";
import type { Node, Edge } from "@xyflow/react";
import { type NodeDefinition } from "@/nodes/types";
import { NODE_REGISTRY } from "@/nodes/registry";
import { ConnectionInspector } from "@/components/inspectors";
import { storage } from "@/services/storage";

// ─── Props ───────────────────────────────────────────────────
interface InspectorPanelProps {
  selectedNode: Node | null;
  onAddNode: (definition: NodeDefinition) => void;
  onUpdateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  onRunWorkflow: (triggerNodeId?: string) => void;
  onChatSend?: (nodeId: string, text: string) => void;
  onRetryWorkflow?: (nodeId: string) => void;
  isRunning: boolean;
  nodes?: Node[];
  edges?: Edge[];
  onDragStartNode?: (type: string) => void;
  onDragEndNode?: () => void;
  selectedEdge: Edge | null;
  onUpdateEdgeData?: (edgeId: string, edgeType: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
  workflowControl?: { isRunning: boolean; isPaused: boolean; hasError: boolean };
  onPauseWorkflow?: (nodeId: string) => void;
  onResumeWorkflow?: (nodeId: string) => void;
  onStopWorkflow?: (nodeId: string) => void;
}

// ─── Inspector Panel ─────────────────────────────────────────
export default function InspectorPanel({
  selectedNode,
  onAddNode,
  onUpdateNodeData,
  onRunWorkflow,
  onChatSend,
  onRetryWorkflow,
  isRunning,
  nodes,
  edges,
  onDragStartNode,
  onDragEndNode,
  selectedEdge,
  onUpdateEdgeData,
  onDeleteEdge,
  workflowControl = { isRunning: false, isPaused: false, hasError: false },
  onPauseWorkflow,
  onResumeWorkflow,
  onStopWorkflow,
}: InspectorPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [width, setWidth] = useState(() => storage.getInspectorWidth(320));
  const [isResizing, setIsResizing] = useState(false);



  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleDoubleClick = () => {
    setWidth(320);
    storage.setInspectorWidth(320);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Inspector is docked to the right edge, so width grows as mouse moves left (smaller clientX)
      const newWidth = window.innerWidth - e.clientX;
      const boundedWidth = Math.max(280, Math.min(newWidth, 800));
      setWidth(boundedWidth);
      storage.setInspectorWidth(boundedWidth);
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
        className="absolute top-0 bottom-0 left-0 w-1.5 -ml-0.75 cursor-col-resize select-none z-50 group"
        title="Double-click to reset width"
      >
        <div
          className={`absolute top-0 bottom-0 left-0.5 w-0.5 transition-colors duration-150 h-full ${
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
            {/* Real-time Execution Controls */}
            {workflowControl && workflowControl.isRunning && (
              <div className="bg-primary/45 border border-border-subtle rounded-lg p-3.5 flex flex-col gap-3 relative overflow-hidden backdrop-blur-md animate-[fadeIn_0.15s_ease-out]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${workflowControl.isPaused ? "bg-amber-500 shadow-[0_0_8px_#f59e0b]" : "bg-emerald-500 shadow-[0_0_8px_#10b981] animate-pulse"} select-none`} />
                    <span className="text-xs uppercase tracking-widest text-text-main font-bold select-none">
                      {workflowControl.isPaused ? "Workflow Paused" : "Workflow Executing"}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {workflowControl.isPaused ? (
                    <button
                      onClick={() => onResumeWorkflow && onResumeWorkflow(selectedNode.id)}
                      className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 hover:border-emerald-500/60 text-emerald-200 hover:text-white rounded-md py-2 text-xs font-semibold cursor-pointer transition-all flex justify-center items-center gap-1.5 select-none shadow-sm"
                    >
                      <span>▶️</span>
                      <span>Resume</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => onPauseWorkflow && onPauseWorkflow(selectedNode.id)}
                      className="flex-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 hover:border-amber-500/60 text-amber-200 hover:text-white rounded-md py-2 text-xs font-semibold cursor-pointer transition-all flex justify-center items-center gap-1.5 select-none shadow-sm"
                    >
                      <span>⏸️</span>
                      <span>Pause</span>
                    </button>
                  )}
                  <button
                    onClick={() => onStopWorkflow && onStopWorkflow(selectedNode.id)}
                    className="flex-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 hover:border-red-500/60 text-red-200 hover:text-white rounded-md py-2 text-xs font-semibold cursor-pointer transition-all flex justify-center items-center gap-1.5 select-none shadow-sm"
                  >
                    <span>⏹️</span>
                    <span>Stop</span>
                  </button>
                </div>
              </div>
            )}

            {/* Error Message & Retry Action Banner */}
            {selectedNode.data?.status === "error" && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 flex flex-col gap-3 relative overflow-hidden backdrop-blur-md">
                <div className="flex items-start gap-2.5">
                  <span className="text-lg leading-none select-none">⚠️</span>
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="text-xs uppercase tracking-widest text-red-400 font-bold">Node Execution Failed</span>
                    <p className="text-[11px] text-text-secondary leading-relaxed wrap-break-word mt-1 mb-0 whitespace-pre-wrap">
                      {String(selectedNode.data?.error || "An unknown execution error occurred.")}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {onRetryWorkflow && (
                    <button
                      onClick={() => onRetryWorkflow(selectedNode.id)}
                      disabled={isRunning}
                      className="flex-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 hover:border-red-500/60 text-red-200 hover:text-white rounded-md py-2 text-xs font-semibold cursor-pointer transition-all flex justify-center items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed select-none shadow-sm"
                    >
                      <span>🔄</span>
                      <span>Retry</span>
                    </button>
                  )}
                  <button
                    onClick={() => onUpdateNodeData(selectedNode.id, { ...selectedNode.data, status: undefined, error: undefined })}
                    className="flex-1 bg-primary/45 hover:bg-card-hover border border-border-subtle rounded-md py-2 text-xs font-semibold cursor-pointer transition-all flex justify-center items-center gap-1.5 select-none shadow-sm text-text-secondary hover:text-text-main"
                  >
                    <span>🗑️</span>
                    <span>Clear</span>
                  </button>
                </div>
              </div>
            )}

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
        <ConnectionInspector
          selectedEdge={selectedEdge}
          nodes={nodes || []}
          onUpdateEdgeData={onUpdateEdgeData}
          onDeleteEdge={onDeleteEdge}
        />
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
