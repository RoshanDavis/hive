import type { InspectorProps } from "./types";
import { formLabelClass, formInputClass } from "@/components/shared/FormField";

export default function NotifyInspector({
  node,
  onUpdate
}: InspectorProps) {
  const messageValue = String(node.data?.message !== undefined ? node.data.message : "{input.value}");
  const outputValue = String(node.data?.output !== undefined ? node.data.output : "{input.value}");

  return (
    <div className="border-t border-border-subtle pt-4 flex flex-col gap-4">
      <div className="text-[11px] uppercase tracking-widest font-bold text-text-muted mb-2">Notification</div>
      
      {/* Notification Message */}
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

      {/* Output Template */}
      <div className="flex flex-col gap-2">
        <label className={formLabelClass}>Output Template</label>
        <textarea
          className={`${formInputClass} resize-y min-h-15 font-inherit`}
          value={outputValue}
          onChange={(e) =>
            onUpdate(node.id, {
              ...node.data,
              output: e.target.value,
            })
          }
          placeholder="e.g. {input.value}"
          rows={2}
        />
      </div>

      <p className="text-[11px] text-text-muted leading-relaxed">
        The <span className="font-semibold text-text-main">Notification Message</span> will appear as an OS notification. The <span className="font-semibold text-text-main">Output Template</span> determines what gets passed to downstream nodes (the envelope's <code className="text-accent-dim bg-card-hover px-1 py-0.5 rounded font-mono font-bold">value</code>). Use <code className="text-accent-dim bg-card-hover px-1 py-0.5 rounded font-mono font-bold">{`{input.value}`}</code> to inject the primary output string, or path expressions like <code className="text-accent-dim bg-card-hover px-1 py-0.5 rounded font-mono font-bold">{`{input.data[0]}`}</code> or <code className="text-accent-dim bg-card-hover px-1 py-0.5 rounded font-mono font-bold">{`{input.metadata.timestamp}`}</code> to select specific fields from the incoming JSON envelope.
      </p>
    </div>
  );
}
