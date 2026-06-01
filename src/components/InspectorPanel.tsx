import { useState, useEffect, useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";
import { type NodeDefinition } from "@/nodes/types";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { getConnectedComponent } from "@/engine/graphTraversal";
import { ConnectionInspector, WorkspaceInspector } from "@/components/inspectors";
import CollapsibleSection from "@/components/inspectors/CollapsibleSection";
import { type SpaceWorkflowSummary } from "@/engine/workflowRows";
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
  /** Space-scoped variants used by the cross-space Workflows list. */
  onRetryWorkflowInSpace?: (spaceId: string, nodeId: string) => void;
  onCancelWorkflowInSpace?: (spaceId: string, nodeId?: string) => void;
  onClearAllStatuses: () => void;
  runningStartNodeIds?: Map<string, number>;
  /** The active space id and the activity summaries for sibling spaces — fed
   * to the Workflows section so it can list runs across every space. */
  activeSpaceId?: string;
  otherSpaceWorkflows?: SpaceWorkflowSummary[];
  nodes?: Node[];
  edges?: Edge[];
  onDragStartNode?: (type: string) => void;
  onDragEndNode?: () => void;
  selectedEdge: Edge | null;
  onUpdateEdgeData?: (edgeId: string, edgeType: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
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
  onRetryWorkflowInSpace,
  onCancelWorkflowInSpace,
  onClearAllStatuses,
  runningStartNodeIds,
  activeSpaceId,
  otherSpaceWorkflows,
  nodes,
  edges,
  onDragStartNode,
  onDragEndNode,
  selectedEdge,
  onUpdateEdgeData,
  onDeleteEdge,
  onDeleteNode,
  showToast,
}: InspectorPanelProps) {
  const [width, setWidth] = useState(() => storage.getInspectorWidth(320));
  const [isResizing, setIsResizing] = useState(false);
  const [showCreateCustom, setShowCreateCustom] = useState(false);
  const [showSaveCustom, setShowSaveCustom] = useState(false);

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
            <h2 className="text-base font-semibold m-0 text-text-main flex items-center gap-2 min-w-0">
              {pluginRegistry.getIcon(selectedNode.type || '')}
              <span className="truncate">
                {pluginRegistry.get(selectedNode.type || '')?.meta.label || selectedNode.type}
              </span>
            </h2>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 pb-32 flex flex-col gap-3">

            {/* Per-node Stop. Visible whenever there's anything to stop — any
                active run anywhere, or this node carries a stuck status
                (paused chat, lingering executing/pending). The Workflows
                section in the workspace inspector also has per-run Stops;
                this one is the quick-access path when you're already
                inspecting a node. */}
            {canStopFromSelected && onCancelWorkflow && (
              <button
                onClick={() => onCancelWorkflow(selectedNode.id)}
                className="w-full bg-danger/15 hover:bg-danger/25 border border-danger/40 hover:border-danger/60 text-danger hover:text-danger-hover rounded-md py-2 px-3 text-xs font-semibold cursor-pointer transition-all flex justify-center items-center gap-1.5 select-none shadow-sm"
              >
                <span>⏹</span>
                <span>Stop Workflow</span>
              </button>
            )}

            {/* Error Message & Retry Action Banner */}
            {selectedNode.data?.status === "error" && (
              <div className="bg-danger/10 border border-danger/30 rounded-lg p-3.5 flex flex-col gap-3 relative backdrop-blur-md">
                <div className="flex items-start gap-2.5">
                  <span className="text-lg leading-none select-none">⚠️</span>
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="text-xs uppercase tracking-widest text-danger font-bold">Node Execution Failed</span>
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
                      className="flex-1 bg-danger/20 hover:bg-danger/30 border border-danger/40 hover:border-danger/60 text-danger hover:text-danger-hover rounded-md py-1.5 px-3 text-xs font-semibold cursor-pointer transition-all flex justify-center items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed select-none shadow-sm"
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

            {/* Label */}
            <CollapsibleSection title="Label" icon="🏷️" defaultOpen={true}>
              <div className="flex gap-3 items-end">
                <div className="flex flex-col gap-2 shrink-0">
                  <label className={formLabelClass}>Icon</label>
                  <input
                    type="text"
                    value={String(selectedNode.data?.icon || "")}
                    placeholder={pluginRegistry.getIcon(selectedNode.type || '')}
                    title="Leave blank to use the default icon for this node type"
                    maxLength={2}
                    /* Inline classes (not formInputClass) — formInputClass carries
                     * w-full, which Tailwind's compiled CSS orders after w-12
                     * alphabetically, so adding "w-12" wouldn't win. */
                    className="w-11 bg-input border border-border-subtle rounded-md px-1 py-2 text-base text-text-main text-center transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_var(--accent-glow)] outline-hidden"
                    onChange={(e) =>
                      onUpdateNodeData(selectedNode.id, {
                        ...selectedNode.data,
                        icon: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  <label className={formLabelClass}>Display name</label>
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
              </div>
            </CollapsibleSection>

            {/* Dynamic Component Rendering based on Registry */}
            {(() => {
              const plugin = pluginRegistry.get(selectedNode.type || '');
              const Inspector = plugin?.inspector;
              if (Inspector) {
                // Only built-ins and preset customs can be saved as a new custom node.
                // Script customs already are their own plugin shape — re-snapshotting
                // them as a preset of themselves wouldn't be useful.
                const canSaveAsCustom = !isCustomType(selectedNode.type);
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
                    onSaveAsCustom={canSaveAsCustom ? () => setShowSaveCustom(true) : undefined}
                    onDeleteNode={onDeleteNode ? () => onDeleteNode(selectedNode.id) : undefined}
                  />
                );
              }
              return null;
            })()}

            {/* Node Info */}
            <CollapsibleSection title="Node Info" icon="🔍" defaultOpen={false}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-text-muted">ID</span>
                  <span className="text-xs text-text-main font-mono break-all select-text">
                    {selectedNode.id}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-text-muted">Position</span>
                  <div className="flex gap-4 text-xs text-text-main font-mono">
                    <span>X: {Math.round(selectedNode.position?.x || 0)}</span>
                    <span>Y: {Math.round(selectedNode.position?.y || 0)}</span>
                  </div>
                </div>
              </div>
            </CollapsibleSection>
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
          activeSpaceId={activeSpaceId || ""}
          otherSpaceWorkflows={otherSpaceWorkflows || []}
          onAddNode={onAddNode}
          onDragStartNode={onDragStartNode}
          onDragEndNode={onDragEndNode}
          onCreateCustom={() => setShowCreateCustom(true)}
          onRetryWorkflowInSpace={(spaceId, id) =>
            onRetryWorkflowInSpace?.(spaceId, id)
          }
          onCancelWorkflowInSpace={(spaceId, id) =>
            onCancelWorkflowInSpace?.(spaceId, id)
          }
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
