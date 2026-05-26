import { useState, useEffect } from "react";
import type { Node, Edge } from "@xyflow/react";
import { type NodeDefinition } from "@/nodes/types";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { ConnectionInspector, WorkspaceInspector } from "@/components/inspectors";
import { storage } from "@/services/storage";

interface InspectorPanelProps {
  workspaceName: string;
  selectedNode: Node | null;
  onAddNode: (definition: NodeDefinition) => void;
  onUpdateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  onRunWorkflow: (triggerNodeId?: string) => void;
  onChatSend?: (nodeId: string, text: string) => void;
  onRetryWorkflow?: (nodeId: string) => void;
  isRunning: boolean;
  runningStartNodeIds?: Set<string>;
  nodes?: Node[];
  edges?: Edge[];
  onDragStartNode?: (type: string) => void;
  onDragEndNode?: () => void;
  selectedEdge: Edge | null;
  onUpdateEdgeData?: (edgeId: string, edgeType: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
}

export default function InspectorPanel({
  workspaceName,
  selectedNode,
  onAddNode,
  onUpdateNodeData,
  onRunWorkflow,
  onChatSend,
  onRetryWorkflow,
  isRunning,
  runningStartNodeIds,
  nodes,
  edges,
  onDragStartNode,
  onDragEndNode,
  selectedEdge,
  onUpdateEdgeData,
  onDeleteEdge,
}: InspectorPanelProps) {
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
              {pluginRegistry.getIcon(selectedNode.type || '')}
              {" "}
              {String(selectedNode.data?.label || selectedNode.type)}
            </h2>
            <span className="text-[10px] uppercase tracking-widest font-bold text-accent bg-accent-glow self-start px-2 py-0.5 rounded-sm">{selectedNode.type}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">

            {/* Error Message & Retry Action Banner */}
            {selectedNode.data?.status === "error" && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 flex flex-col gap-3 relative backdrop-blur-md">
                <div className="flex items-start gap-2.5">
                  <span className="text-lg leading-none select-none">⚠️</span>
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="text-xs uppercase tracking-widest text-red-400 font-bold">Node Execution Failed</span>
                    <p className="text-[11px] text-text-secondary leading-relaxed wrap-break-word mt-1 mb-0 whitespace-pre-wrap">
                      {String(selectedNode.data?.error || "An unknown execution error occurred.")}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 mt-1">
                  {onRetryWorkflow && (
                    <button
                      onClick={() => onRetryWorkflow(selectedNode.id)}
                      disabled={isRunning}
                      className="flex-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 hover:border-red-500/60 text-red-200 hover:text-white rounded-md py-1.5 px-3 text-xs font-semibold cursor-pointer transition-all flex justify-center items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed select-none shadow-sm"
                    >
                      <span>🔄</span>
                      <span>Retry</span>
                    </button>
                  )}
                  <button
                    onClick={() => onUpdateNodeData(selectedNode.id, { ...selectedNode.data, status: undefined, error: undefined })}
                    className="flex-1 bg-primary/45 hover:bg-card-hover border border-border-subtle rounded-md py-1.5 px-3 text-xs font-semibold cursor-pointer transition-all flex justify-center items-center gap-1.5 select-none shadow-sm text-text-secondary hover:text-text-main"
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
              const plugin = pluginRegistry.get(selectedNode.type || '');
              const Inspector = plugin?.inspector;
              if (Inspector) {
                return (
                  <Inspector
                    node={selectedNode}
                    onUpdate={onUpdateNodeData}
                    isRunning={isRunning}
                    runningStartNodeIds={runningStartNodeIds}
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
        <WorkspaceInspector
          workspaceName={workspaceName}
          onAddNode={onAddNode}
          onDragStartNode={onDragStartNode}
          onDragEndNode={onDragEndNode}
        />
      )}
    </div>
  );
}
