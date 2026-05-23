import type { InspectorProps } from "./types";

export default function OutputInspector({
  node,
  onUpdate
}: InspectorProps) {
  return (
    <div className="border-t border-border-subtle pt-4 flex flex-col gap-4">
      <div className="text-[11px] uppercase tracking-widest font-bold text-text-muted mb-2">Generated Output</div>
      <div className="w-full p-3 bg-card border border-dashed border-border-subtle rounded-sm text-text-main text-[13px] font-inherit min-h-[100px] whitespace-pre-wrap break-words">
        {node.data?.outputContent !== undefined && node.data?.outputContent !== null
          ? String(node.data.outputContent)
          : "No output yet."}
      </div>
      <button
        className="w-full rounded-md py-2.5 text-sm font-semibold cursor-pointer transition-all flex justify-center items-center gap-2 bg-transparent border border-dashed border-border-subtle text-text-secondary hover:border-[#ff6b6b] hover:text-[#ff6b6b] hover:bg-[rgba(255,107,107,0.1)] hover:shadow-none"
        onClick={() =>
          onUpdate(node.id, {
            ...node.data,
            outputContent: undefined,
          })
        }
      >
        Clear Output
      </button>
    </div>
  );
}
