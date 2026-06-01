import type { InspectorProps } from "./types";
import type { NodeOutputEnvelope } from "@/engine/types";
import DataConsole from "./shared/DataConsole";
import CollapsibleSection from "./CollapsibleSection";
import InspectorActions from "./InspectorActions";

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
          className="w-full rounded-md py-2.5 text-sm font-semibold cursor-pointer transition-all flex justify-center items-center gap-2 bg-transparent border border-dashed border-border-subtle text-text-secondary hover:border-danger hover:text-danger hover:bg-danger/10 hover:shadow-none"
          onClick={() =>
            onUpdate(node.id, {
              ...node.data,
              outputEnvelope: undefined,
            })
          }
        >
          Clear Output
        </button>
      </InspectorActions>
    </div>
  );
}
