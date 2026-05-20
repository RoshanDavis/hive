import type { InspectorProps } from "./types";

export default function NotifyInspector({
  node,
  onUpdate
}: InspectorProps) {
  return (
    <div className="border-t border-border-subtle pt-4 flex flex-col gap-4">
      <div className="text-[11px] uppercase tracking-widest font-bold text-text-muted mb-2">Notification</div>
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Message</label>
        <textarea
          className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none resize-y min-h-[80px] font-inherit"
          value={String(node.data?.message || "")}
          onChange={(e) =>
            onUpdate(node.id, {
              ...node.data,
              message: e.target.value,
            })
          }
          placeholder="Enter notification message..."
          rows={4}
        />
      </div>
      <p className="text-[11px] text-text-muted leading-relaxed">
        This message will appear as an OS notification when the workflow runs.
      </p>
    </div>
  );
}
