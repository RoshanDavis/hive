import type { ReactNode } from "react";
import CollapsibleSection from "./CollapsibleSection";
import {
  actionButtonDangerClass,
  actionButtonNeutralClass,
} from "./actionButtonStyles";

interface InspectorActionsProps {
  /** Inspector-specific extras rendered above the standard buttons (e.g. Trigger's
   * Run Workflow, Output's Clear Output). When omitted, only the standard buttons render. */
  children?: ReactNode;
  /** Whether the section is open initially. Defaults to false. Trigger overrides
   * to true so its Run button is reachable without an extra click. */
  defaultOpen?: boolean;
  /** Open the Save-as-custom modal seeded from the selected node. Provided by
   * InspectorPanel via InspectorProps. When undefined, the button is hidden. */
  onSaveAsCustom?: () => void;
  /** Delete the selected node (with its incident edges and storage/chat cleanup).
   * Provided by InspectorPanel via InspectorProps. When undefined, the button is hidden. */
  onDeleteNode?: () => void;
}

export default function InspectorActions({
  children,
  defaultOpen = false,
  onSaveAsCustom,
  onDeleteNode,
}: InspectorActionsProps) {
  return (
    <CollapsibleSection title="Actions" icon="⚙️" defaultOpen={defaultOpen}>
      <div className="flex flex-col gap-2">
        {children}
        {onSaveAsCustom && (
          <button
            type="button"
            onClick={onSaveAsCustom}
            title="Save this node's configuration as a reusable custom node"
            className={actionButtonNeutralClass}
          >
            <span>Save as custom node</span>
          </button>
        )}
        {onDeleteNode && (
          <button
            type="button"
            onClick={onDeleteNode}
            title="Delete this node and its connections"
            className={actionButtonDangerClass}
          >
            <span>🗑️</span>
            <span>Delete node</span>
          </button>
        )}
      </div>
    </CollapsibleSection>
  );
}
