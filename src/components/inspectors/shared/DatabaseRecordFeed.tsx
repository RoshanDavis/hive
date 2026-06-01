interface DatabaseRecord {
  id?: string;
  timestamp?: string;
  source?: string;
  content?: string;
}

interface DatabaseRecordFeedProps {
  records: DatabaseRecord[];
}

export default function DatabaseRecordFeed({ records }: DatabaseRecordFeedProps) {
  if (!records || records.length === 0) {
    return (
      <div className="bg-primary/70 border border-border-subtle rounded-lg p-3 text-center text-[11px] text-text-secondary/60 italic select-none">
        No records stored yet.
      </div>
    );
  }

  return (
    <div className="bg-primary/70 border border-border-subtle rounded-lg p-3 max-h-40 overflow-y-auto font-mono text-[11px] leading-relaxed text-text-main scrollbar-thin select-text flex flex-col gap-1">
      {records.map((rec, idx) => {
        const time = rec.timestamp || "--:--:--";
        const source = rec.source || "Unknown";
        const content = rec.content || "";
        const sourceLower = source.toLowerCase();

        let sourceColor = "text-text-secondary"; // Default
        if (sourceLower === "user" || sourceLower === "you") {
          sourceColor = "text-content-user";
        } else if (sourceLower === "system") {
          sourceColor = "text-content-system";
        } else if (sourceLower.includes("ollama") || sourceLower.includes("llm") || sourceLower.includes("robot")) {
          sourceColor = "text-content-assistant";
        } else if (sourceLower.includes("notify")) {
          sourceColor = "text-content-notification";
        }

        return (
          <div key={rec.id || idx} className="py-0.5 border-b border-border-subtle/30 last:border-0 hover:bg-card-hover/30 rounded px-1 select-text">
            <span className="text-text-muted mr-1">[{time}]</span>
            <span className={`${sourceColor} font-semibold mr-1.5`}>[{source}]</span>
            <span className="text-text-main">{content}</span>
          </div>
        );
      })}
    </div>
  );
}
