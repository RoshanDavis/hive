import type { ReactNode } from "react";
import CollapsibleSection from "./CollapsibleSection";

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
  const hasExtras = children !== undefined && children !== null && children !== false;
  return (
    <CollapsibleSection title="Actions" icon="⚙️" defaultOpen={defaultOpen}>
      <div className="flex flex-col gap-2">
        {hasExtras && children}
        {hasExtras && (onSaveAsCustom || onDeleteNode) && (
          <div className="border-t border-border-subtle/60 mt-1 pt-2" />
        )}
        {onSaveAsCustom && (
          <button
            type="button"
            onClick={onSaveAsCustom}
            title="Save this node's configuration as a reusable custom node"
            className="w-full bg-card hover:bg-card-hover border border-border-subtle hover:border-border-card text-text-main rounded-md py-2 text-xs font-semibold cursor-pointer transition-colors flex justify-center items-center gap-2"
          >
            <span>＋</span>
            <span>Save as custom</span>
          </button>
        )}
        {onDeleteNode && (
          <button
            type="button"
            onClick={onDeleteNode}
            title="Delete this node and its connections"
            className="w-full bg-danger/10 hover:bg-danger/20 border border-danger/30 hover:border-danger/50 text-danger hover:text-danger-hover rounded-md py-2 text-xs font-semibold cursor-pointer transition-colors flex justify-center items-center gap-2"
          >
            <span>🗑️</span>
            <span>Delete node</span>
          </button>
        )}
      </div>
    </CollapsibleSection>
  );
}
