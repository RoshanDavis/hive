import CollapsibleSection from "./CollapsibleSection";

export default function WorkflowsSection() {
  return (
    <CollapsibleSection title="Workflows" icon="⚙️" defaultOpen={false}>
      <div className="flex flex-col items-center justify-center text-text-muted gap-2 py-6">
        <span className="text-2xl opacity-40">🔗</span>
        <span className="text-xs font-medium">No workflows yet</span>
        <span className="text-[10px] text-text-muted/60 text-center leading-relaxed max-w-[180px]">
          Workflow tracking for this workspace will appear here
        </span>
      </div>
    </CollapsibleSection>
  );
}
