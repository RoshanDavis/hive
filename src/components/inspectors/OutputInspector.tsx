import type { InspectorProps } from "./types";
import DataConsole from "./shared/DataConsole";

export default function OutputInspector({
  node,
  onUpdate
}: InspectorProps) {
  const content = node.data?.outputContent !== undefined && node.data?.outputContent !== null
    ? String(node.data.outputContent)
    : undefined;

  const upstreamEnvelopeString = node.data?.upstreamEnvelope
    ? JSON.stringify(node.data.upstreamEnvelope, null, 2)
    : undefined;

  return (
    <div className="border-t border-border-subtle pt-4 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="text-[11px] uppercase tracking-widest font-bold text-text-muted">Generated Output</div>
        <DataConsole content={content} placeholder="No output yet." />
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[11px] uppercase tracking-widest font-bold text-text-muted">Raw JSON Message</div>
        <DataConsole content={upstreamEnvelopeString} placeholder="No raw JSON received yet." />
      </div>

      <button
        className="w-full rounded-md py-2.5 text-sm font-semibold cursor-pointer transition-all flex justify-center items-center gap-2 bg-transparent border border-dashed border-border-subtle text-text-secondary hover:border-[#ff6b6b] hover:text-[#ff6b6b] hover:bg-[rgba(255,107,107,0.1)] hover:shadow-none"
        onClick={() =>
          onUpdate(node.id, {
            ...node.data,
            outputContent: undefined,
            upstreamEnvelope: undefined,
          })
        }
      >
        Clear Output
      </button>
    </div>
  );
}
