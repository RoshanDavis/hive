import type { InspectorProps } from "./types";
import type { NodeOutputEnvelope } from "@/engine/types";
import DataConsole from "./shared/DataConsole";
import CollapsibleSection from "./CollapsibleSection";
import InspectorActions from "./InspectorActions";
import { actionButtonNeutralClass } from "./actionButtonStyles";

export default function OutputInspector({
  node,
  onUpdate,
  onSaveAsCustom,
  onDeleteNode,
}: InspectorProps) {
  const envelope = node.data?.outputEnvelope as NodeOutputEnvelope | undefined;
  const content = envelope?.value !== undefined && envelope?.value !== null
    ? String(envelope.value)
    : undefined;

  const hasContent = content !== undefined && content !== "";

  const upstreamEnvelopeString = envelope
    ? JSON.stringify(envelope, null, 2)
    : undefined;

  return (
    <div className="flex flex-col gap-3">
      <CollapsibleSection
        title="Generated Output"
        icon="📤"
        defaultOpen={hasContent}
      >
        <DataConsole content={content} placeholder="No output yet." />
      </CollapsibleSection>

      <CollapsibleSection title="Raw JSON Envelope" icon="🧾" defaultOpen={false}>
        <DataConsole content={upstreamEnvelopeString} placeholder="No raw JSON received yet." />
      </CollapsibleSection>

      <InspectorActions onSaveAsCustom={onSaveAsCustom} onDeleteNode={onDeleteNode}>
        <button
          type="button"
          className={actionButtonNeutralClass}
          onClick={() =>
            onUpdate(node.id, {
              ...node.data,
              outputEnvelope: undefined,
            })
          }
          disabled={!hasContent && !envelope}
          title={!hasContent && !envelope ? "No output to clear" : undefined}
        >
          <span>Clear output</span>
        </button>
      </InspectorActions>
    </div>
  );
}
