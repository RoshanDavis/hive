import type { Node } from "@xyflow/react";
import { type NodeDefinition } from "@/nodes/types";
import { type SpaceWorkflowSummary } from "@/engine/workflowRows";
import NodePaletteSection from "./NodePaletteSection";
import WorkflowsSection from "./WorkflowsSection";

interface WorkspaceInspectorProps {
  nodes: Node[];
  runningStartNodeIds: Map<string, number>;
  activeSpaceId: string;
  otherSpaceWorkflows: SpaceWorkflowSummary[];
  onAddNode: (definition: NodeDefinition) => void;
  onDragStartNode?: (type: string) => void;
  onDragEndNode?: () => void;
  onCreateCustom?: () => void;
  onRetryWorkflowInSpace: (spaceId: string, nodeId: string) => void;
  onCancelWorkflowInSpace: (spaceId: string, nodeId?: string) => void;
  onClearAllStatuses: () => void;
}

export default function WorkspaceInspector({
  nodes,
  runningStartNodeIds,
  activeSpaceId,
  otherSpaceWorkflows,
  onAddNode,
  onDragStartNode,
  onDragEndNode,
  onCreateCustom,
  onRetryWorkflowInSpace,
  onCancelWorkflowInSpace,
  onClearAllStatuses,
}: WorkspaceInspectorProps) {
  return (
    <>
      <div className="p-4 border-b border-border-subtle bg-card flex flex-col gap-1">
        <h2 className="text-base font-semibold m-0 text-text-main flex items-center gap-2">
          <span>🐝</span>
          Workspace
        </h2>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
        <WorkflowsSection
          nodes={nodes}
          runningStartNodeIds={runningStartNodeIds}
          activeSpaceId={activeSpaceId}
          otherSpaceWorkflows={otherSpaceWorkflows}
          onRetryWorkflowInSpace={onRetryWorkflowInSpace}
          onCancelWorkflowInSpace={onCancelWorkflowInSpace}
          onClearAllStatuses={onClearAllStatuses}
        />
        <NodePaletteSection
          onAddNode={onAddNode}
          onDragStartNode={onDragStartNode}
          onDragEndNode={onDragEndNode}
          onCreateCustom={onCreateCustom}
        />
      </div>
    </>
  );
}
