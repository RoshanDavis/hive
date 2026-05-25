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
      <div className="bg-[#0b0b0d]/70 border border-[#222] rounded-lg p-3 text-center text-[11px] text-text-secondary/60 italic select-none">
        No records stored yet.
      </div>
    );
  }

  return (
    <div className="bg-[#0b0b0d]/70 border border-[#222] rounded-lg p-3 max-h-40 overflow-y-auto font-mono text-[11px] leading-relaxed text-[#e4e4e7] scrollbar-thin select-text flex flex-col gap-1">
      {records.map((rec, idx) => {
        const time = rec.timestamp || "--:--:--";
        const source = rec.source || "Unknown";
        const content = rec.content || "";
        const sourceLower = source.toLowerCase();

        let sourceColor = "text-[#888888]"; // Default
        if (sourceLower === "user" || sourceLower === "you") {
          sourceColor = "text-[#34d399]"; // User green
        } else if (sourceLower === "system") {
          sourceColor = "text-[#818cf8]"; // System purple-blue
        } else if (sourceLower.includes("ollama") || sourceLower.includes("llm") || sourceLower.includes("robot")) {
          sourceColor = "text-[#c084fc]"; // AI Ollama purple
        } else if (sourceLower.includes("notify")) {
          sourceColor = "text-[#60a5fa]"; // Notify blue
        }

        return (
          <div key={rec.id || idx} className="py-0.5 border-b border-[#222]/10 last:border-0 hover:bg-[#1a1a24]/10 rounded px-1 select-text">
            <span className="text-[#52525b] mr-1">[{time}]</span>
            <span className={`${sourceColor} font-semibold mr-1.5`}>[{source}]</span>
            <span className="text-[#d4d4d8]">{content}</span>
          </div>
        );
      })}
    </div>
  );
}
