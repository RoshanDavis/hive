import type { InspectorProps } from "./types";
import CollapsibleSection from "./CollapsibleSection";
import InspectorActions from "./InspectorActions";
import { actionButtonNeutralClass } from "./actionButtonStyles";

interface JSONStorageRecord {
  id: string;
  timestamp: string;
  source: string;
  content: string;
}

export default function JSONStorageInspector({
  node,
  onUpdate,
  isRunning,
  onSaveAsCustom,
  onDeleteNode,
}: InspectorProps) {
  const records = (node.data?.records as JSONStorageRecord[]) || [];

  const handleClear = () => {
    onUpdate(node.id, {
      ...node.data,
      records: [],
    });
  };

  const canClear = records.length > 0 && !isRunning;

  return (
    <div className="flex flex-col gap-3">
      <CollapsibleSection
        title="Records"
        icon="💾"
        defaultOpen={true}
        badge={records.length}
      >
        <div className="bg-primary border border-border-subtle rounded-md flex flex-col overflow-x-auto">
          {records.length > 0 ? (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-card border-b border-border-subtle text-text-secondary font-semibold uppercase tracking-wider">
                  <th className="p-3 w-20">Time</th>
                  <th className="p-3 w-22.5">Source</th>
                  <th className="p-3">Content</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec) => (
                  <tr key={rec.id} className="border-b border-border-subtle hover:bg-card-hover transition-colors text-text-main">
                    <td className="p-3 text-text-secondary whitespace-nowrap">{rec.timestamp}</td>
                    <td className="p-3 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        rec.source.toLowerCase() === "user" || rec.source.toLowerCase() === "you"
                          ? "bg-accent-glow text-accent border border-accent-dim/30"
                          : "bg-input text-text-secondary border border-border-subtle"
                      }`}>
                        {rec.source}
                      </span>
                    </td>
                    <td className="p-3 font-mono leading-relaxed whitespace-pre-wrap break-all">{rec.content}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 text-text-muted gap-2 py-8 text-center px-4">
              <span className="text-3xl opacity-50">💾</span>
              <span className="text-xs font-medium">Storage is empty</span>
              <span className="text-[10px] text-text-muted leading-relaxed max-w-50">
                Connect the Chat node's bottom handle to this JSON Storage node to log conversation histories.
              </span>
            </div>
          )}
        </div>
      </CollapsibleSection>

      <InspectorActions onSaveAsCustom={onSaveAsCustom} onDeleteNode={onDeleteNode}>
        <button
          type="button"
          className={actionButtonNeutralClass}
          onClick={handleClear}
          disabled={!canClear}
          title={records.length === 0 ? "No records to clear" : isRunning ? "Wait for the current run to finish" : undefined}
        >
          <span>Clear data</span>
        </button>
      </InspectorActions>
    </div>
  );
}
