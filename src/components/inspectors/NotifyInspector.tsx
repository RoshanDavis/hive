import type { InspectorProps } from "./types";
import type { NodeOutputEnvelope } from "@/engine/types";
import CollapsibleSection from "./CollapsibleSection";
import InspectorActions from "./InspectorActions";
import DataConsole from "./shared/DataConsole";
import { formLabelClass, formInputClass } from "@/components/shared/FormField";

export default function NotifyInspector({
  node,
  onUpdate,
  onSaveAsCustom,
  onDeleteNode,
}: InspectorProps) {
  const messageValue = String(node.data?.message !== undefined ? node.data.message : "{input.value}");
  const envelope = node.data?.outputEnvelope as NodeOutputEnvelope | undefined;
  const envelopeString = envelope ? JSON.stringify(envelope, null, 2) : undefined;
  const hasEnvelope = envelope !== undefined;

  return (
    <div className="flex flex-col gap-3">
      <CollapsibleSection title="Templates" icon="🔔" defaultOpen={true}>
        <div className="flex flex-col gap-2">
          <label className={formLabelClass}>Notification Message</label>
          <textarea
            className={`${formInputClass} resize-y min-h-15 font-inherit`}
            value={messageValue}
            onChange={(e) =>
              onUpdate(node.id, {
                ...node.data,
                message: e.target.value,
              })
            }
            placeholder="e.g. {input.value}"
            rows={2}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Raw JSON Envelope"
        icon="🧾"
        defaultOpen={hasEnvelope}
      >
        <DataConsole
          content={envelopeString}
          placeholder="No envelope yet. Run the workflow once to see what gets passed downstream."
        />
      </CollapsibleSection>

      <InspectorActions onSaveAsCustom={onSaveAsCustom} onDeleteNode={onDeleteNode} />
    </div>
  );
}
