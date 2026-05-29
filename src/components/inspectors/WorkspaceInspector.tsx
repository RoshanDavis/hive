import { type NodeDefinition } from "@/nodes/types";
import NodePaletteSection from "./NodePaletteSection";

interface WorkspaceInspectorProps {
  workspaceName: string;
  onAddNode: (definition: NodeDefinition) => void;
  onDragStartNode?: (type: string) => void;
  onDragEndNode?: () => void;
  onCreateCustom?: () => void;
}

export default function WorkspaceInspector({
  workspaceName,
  onAddNode,
  onDragStartNode,
  onDragEndNode,
  onCreateCustom,
}: WorkspaceInspectorProps) {
  return (
    <>
      <div className="p-4 border-b border-border-subtle bg-card flex flex-col gap-1">
        <h2 className="text-base font-semibold m-0 text-text-main flex items-center gap-2">
          <span>🐝</span>
          Workspace
        </h2>
        <span className="text-[10px] uppercase tracking-widest font-bold text-accent bg-accent-glow self-start px-2 py-0.5 rounded-sm">
          {workspaceName}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
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
