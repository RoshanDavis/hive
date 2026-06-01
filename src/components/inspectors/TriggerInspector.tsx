import type { InspectorProps } from "./types";
import InspectorActions from "./InspectorActions";
import {
  actionButtonPrimaryActiveClass,
  actionButtonPrimaryClass,
} from "./actionButtonStyles";

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
        type="button"
        className={isRunning ? actionButtonPrimaryActiveClass : actionButtonPrimaryClass}
        onClick={() => onRun && onRun(node.id)}
        disabled={isRunning}
        id="run-workflow-btn"
      >
        {isRunning ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span>Running…</span>
          </>
        ) : (
          <>
            <span>▶</span>
            <span>Run Workflow</span>
          </>
        )}
      </button>
    </InspectorActions>
  );
}
