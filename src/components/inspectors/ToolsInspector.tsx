import type { InspectorProps } from "./types";
import type { AgentToolSettings } from "@/nodes/types";
import CollapsibleSection from "./CollapsibleSection";
import InspectorActions from "./InspectorActions";
import ToolsSelector, { type ToolsSelection } from "./shared/ToolsSelector";

export default function ToolsInspector({
  node,
  onUpdate,
  workspacePath,
  onSaveAsCustom,
  onDeleteNode,
}: InspectorProps) {
  const value: ToolsSelection = {
    native: Array.isArray(node.data?.native) ? (node.data.native as string[]) : [],
    mcp: Array.isArray(node.data?.mcp) ? (node.data.mcp as string[]) : [],
    skills: Array.isArray(node.data?.skills) ? (node.data.skills as string[]) : [],
  };
  const toolSettings = node.data?.toolSettings as AgentToolSettings | undefined;

  return (
    <div className="flex flex-col gap-3">
      <CollapsibleSection title="Tools" icon="🛠️" defaultOpen={true}>
        <ToolsSelector
          value={value}
          onChange={(next) => onUpdate(node.id, { ...node.data, ...next })}
          workspacePath={workspacePath}
          toolSettings={toolSettings}
          onToolSettingsChange={(ts) => onUpdate(node.id, { ...node.data, toolSettings: ts })}
        />
      </CollapsibleSection>

      <InspectorActions onSaveAsCustom={onSaveAsCustom} onDeleteNode={onDeleteNode} />
    </div>
  );
}
