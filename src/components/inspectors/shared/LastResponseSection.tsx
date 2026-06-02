import CollapsibleSection from "../CollapsibleSection";
import DataConsole from "./DataConsole";

interface LastResponseSectionProps {
  /** The envelope value to show. Empty/undefined renders the "no response" state. */
  value: string | undefined;
  onClear: () => void;
}

/** "Last Response" output panel, shared by LLM and Agent inspectors. */
export default function LastResponseSection({ value, onClear }: LastResponseSectionProps) {
  const hasResponse = value !== undefined && value !== null && String(value) !== "";

  return (
    <CollapsibleSection
      title="Last Response"
      icon="💬"
      defaultOpen={hasResponse}
      badge={hasResponse ? String(value).length : undefined}
    >
      {hasResponse ? (
        <div className="flex flex-col gap-2">
          <div className="flex justify-end">
            <button
              onClick={onClear}
              className="text-[10px] text-text-muted hover:text-danger transition-colors cursor-pointer border-none bg-transparent"
              title="Clear response"
            >
              Clear
            </button>
          </div>
          <DataConsole content={String(value)} />
        </div>
      ) : (
        <div className="text-[11px] text-text-muted py-2 text-center select-none">
          No response yet.
        </div>
      )}
    </CollapsibleSection>
  );
}
