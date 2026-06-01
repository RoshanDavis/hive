import { useState, useEffect, useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";
import { type NodeDefinition } from "@/nodes/types";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { getConnectedComponent } from "@/engine/graphTraversal";
import { ConnectionInspector, WorkspaceInspector } from "@/components/inspectors";
import { storage } from "@/services/storage";
import CustomNodeFormModal, {
  stripRuntimeFields,
} from "@/components/customNodes/CustomNodeFormModal";
import { isCustomType } from "@/types/customNodes";
import { formLabelClass, formInputClass } from "@/components/shared/FormField";

interface InspectorPanelProps {
  workspacePath: string;
  selectedNode: Node | null;
  onAddNode: (definition: NodeDefinition) => void;
  onUpdateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  onRunWorkflow: (triggerNodeId?: string) => void;
  onChatSend?: (nodeId: string, text: string) => void;
  onRetryWorkflow?: (nodeId: string) => void;
  onCancelWorkflow?: (nodeId?: string) => void;
  onClearAllStatuses: () => void;
  runningStartNodeIds?: Map<string, number>;
  nodes?: Node[];
  edges?: Edge[];
  onDragStartNode?: (type: string) => void;
  onDragEndNode?: () => void;
  selectedEdge: Edge | null;
  onUpdateEdgeData?: (edgeId: string, edgeType: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
  showToast: (msg: string, kind: "success" | "error" | "info") => void;
}

export default function InspectorPanel({
  workspacePath,
  selectedNode,
  onAddNode,
  onUpdateNodeData,
  onRunWorkflow,
  onChatSend,
  onRetryWorkflow,
  onCancelWorkflow,
  onClearAllStatuses,
  runningStartNodeIds,
  nodes,
  edges,
  onDragStartNode,
  onDragEndNode,
  selectedEdge,
  onUpdateEdgeData,
  onDeleteEdge,
  showToast,
}: InspectorPanelProps) {
  const [width, setWidth] = useState(() => storage.getInspectorWidth(320));
  const [isResizing, setIsResizing] = useState(false);
  const [showSaveCustom, setShowSaveCustom] = useState(false);
  const [showCreateCustom, setShowCreateCustom] = useState(false);

  // Per-selected-node running state. A run's `startKey` is the comma-joined
  // ids of its start nodes (see `runWorkflow` in runnerSession.ts), so this
  // node is "running" iff its id appears as a member of any active key.
  // Without this scoping, every node's Run/Retry UI would spin whenever any
  // other workflow ran — runs are independent and must not interlock visually.
  const isRunning = useMemo(() => {
    if (!selectedNode || !runningStartNodeIds || runningStartNodeIds.size === 0) {
      return false;
    }
    for (const key of runningStartNodeIds.keys()) {
      if (key.split(",").includes(selectedNode.id)) return true;
    }
    return false;
  }, [selectedNode, runningStartNodeIds]);

  // Stop visibility scoped to the selected node's connected component (a.k.a.
  // its workflow). Show Stop iff this workflow has something stoppable —
  // either a node currently in flight, or a node carrying a stuck status
  // (typical: a paused chat past its 1.5s fade window with no live run left
  // to reference). Different components are different workflows, so a Stop
  // on workflow B's node must never reach into a running workflow A.
  const canStopFromSelected = useMemo(() => {
    if (!selectedNode) return false;
    const component = getConnectedComponent(selectedNode.id, edges || []);
    for (const id of component) {
      const n = (nodes || []).find((nd) => nd.id === id);
      if (!n) continue;
      const s = n.data?.status;
      if (s === "waiting" || s === "executing" || s === "pending") return true;
      // A node finished with success/error but whose run hasn't faded yet
      // still carries `statusRunId`; that means the run is still tracked in
      // `activeRuns` and stop should be available on its component-mates.
      if (n.data?.statusRunId && (s === "success" || s === "error")) return true;
    }
    return false;
  }, [selectedNode, nodes, edges]);

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
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold m-0 text-text-main flex items-center gap-2 min-w-0">
                {pluginRegistry.getIcon(selectedNode.type || '')}
                {" "}
                <span className="truncate">
                  {pluginRegistry.get(selectedNode.type || '')?.meta.label || selectedNode.type}
                </span>
              </h2>
              {!isCustomType(selectedNode.type) && (
                <button
                  onClick={() => setShowSaveCustom(true)}
                  title="Save this node's configuration as a reusable custom node"
                  className="shrink-0 text-[11px] text-text-muted hover:text-accent border border-border-subtle hover:border-accent-dim rounded-md px-2 py-1 cursor-pointer bg-card hover:bg-card-hover transition-colors flex items-center gap-1"
                >
                  <span>＋</span>
                  <span>Save as custom</span>
                </button>
              )}
            </div>
            <span className="text-[10px] uppercase tracking-widest font-bold text-accent bg-accent-glow self-start px-2 py-0.5 rounded-sm">{selectedNode.type}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">

            {/* Per-node Stop. Visible whenever there's anything to stop — any
                active run anywhere, or this node carries a stuck status
                (paused chat, lingering executing/pending). The Workflows
                section in the workspace inspector also has per-run Stops;
                this one is the quick-access path when you're already
                inspecting a node. */}
            {canStopFromSelected && onCancelWorkflow && (
              <button
                onClick={() => onCancelWorkflow(selectedNode.id)}
                className="w-full bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 hover:border-red-500/60 text-red-200 hover:text-white rounded-md py-2 px-3 text-xs font-semibold cursor-pointer transition-all flex justify-center items-center gap-1.5 select-none shadow-sm"
              >
                <span>⏹</span>
                <span>Stop Workflow</span>
              </button>
            )}

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
                    onClick={() => onUpdateNodeData(selectedNode.id, { ...selectedNode.data, status: undefined, statusRunId: undefined, error: undefined })}
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
              <label className={formLabelClass}>Label</label>
              <input
                className={formInputClass}
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
                    onCancel={onCancelWorkflow}
                    onChatSend={onChatSend}
                    nodes={nodes}
                    edges={edges}
                    workspacePath={workspacePath}
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
          nodes={nodes || []}
          runningStartNodeIds={runningStartNodeIds || new Map()}
          onAddNode={onAddNode}
          onDragStartNode={onDragStartNode}
          onDragEndNode={onDragEndNode}
          onCreateCustom={() => setShowCreateCustom(true)}
          onRetryWorkflow={(id) => onRetryWorkflow?.(id)}
          onCancelWorkflow={(id) => onCancelWorkflow?.(id)}
          onClearAllStatuses={onClearAllStatuses}
        />
      )}

      {showCreateCustom && (
        <CustomNodeFormModal
          isOpen={showCreateCustom}
          onClose={() => setShowCreateCustom(false)}
          showToast={showToast}
          allowWorkspaceScope={true}
        />
      )}

      {showSaveCustom && selectedNode && (
        <CustomNodeFormModal
          isOpen={showSaveCustom}
          onClose={() => setShowSaveCustom(false)}
          showToast={showToast}
          allowWorkspaceScope={true}
          initial={{
            baseType: selectedNode.type || "",
            presetData: stripRuntimeFields(selectedNode.data || {}),
            name: String(selectedNode.data?.label || ""),
            lockBaseType: true,
          }}
        />
      )}
    </div>
  );
}
