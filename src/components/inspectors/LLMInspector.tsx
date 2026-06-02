import type { InspectorProps } from "./types";
import type { NodeOutputEnvelope } from "@/engine/types";
import LLMConfigFields from "./shared/LLMConfigFields";
import LastResponseSection from "./shared/LastResponseSection";
import InspectorActions from "./InspectorActions";

export default function LLMInspector({
  node,
  onUpdate,
  workspacePath,
  onSaveAsCustom,
  onDeleteNode,
}: InspectorProps) {
  const lastValue = (node.data?.outputEnvelope as NodeOutputEnvelope | undefined)?.value;

  return (
    <div className="flex flex-col gap-3">
      <LLMConfigFields
        values={node.data}
        onChange={(next) => onUpdate(node.id, next)}
        workspacePath={workspacePath}
      />

      <LastResponseSection
        value={lastValue}
        onClear={() => onUpdate(node.id, { ...node.data, outputEnvelope: undefined })}
      />

      <InspectorActions onSaveAsCustom={onSaveAsCustom} onDeleteNode={onDeleteNode} />
    </div>
  );
}
