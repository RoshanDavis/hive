import type { InspectorProps } from "./types";
import InspectorActions from "./InspectorActions";

export default function TriggerInspector({
  isRunning,
  onRun,
  node,
  onSaveAsCustom,
  onDeleteNode,
}: InspectorProps) {
  return (
    <InspectorActions
      defaultOpen={true}
      onSaveAsCustom={onSaveAsCustom}
      onDeleteNode={onDeleteNode}
    >
      <button
        className={`w-full border border-accent text-accent rounded-md py-2.5 text-sm font-semibold cursor-pointer transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${isRunning ? "bg-accent text-primary shadow-[0_0_12px_rgba(212,230,0,0.3)]" : "bg-card hover:bg-accent hover:text-primary hover:shadow-[0_0_12px_rgba(212,230,0,0.3)]"}`}
        onClick={() => onRun && onRun(node.id)}
        disabled={isRunning}
        id="run-workflow-btn"
      >
        {isRunning ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Running...
          </>
        ) : (
          <>▶ Run Workflow</>
        )}
      </button>
    </InspectorActions>
  );
}
