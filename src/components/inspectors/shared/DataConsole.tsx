import { useState } from "react";

interface DataConsoleProps {
  content: string | null | undefined;
  placeholder?: string;
  /** Tailwind max-height class for the scroll surface. Default `"max-h-35"`. */
  maxHeight?: string;
}

export default function DataConsole({
  content,
  placeholder = "No data transmitted yet.",
  maxHeight = "max-h-35",
}: DataConsoleProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const hasData = content !== null && content !== undefined;
  const isEmpty = content === "";

  let displayVal = placeholder;
  if (hasData) {
    displayVal = isEmpty ? '"" (empty string)' : content;
  }

  return (
    <div className={`bg-primary/70 border border-border-subtle rounded-lg p-3 font-mono text-[11px] leading-relaxed text-text-main overflow-x-auto relative group ${maxHeight} overflow-y-auto pr-10 scrollbar-thin select-text`}>
      {hasData && !isEmpty && (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 hover:bg-card-hover text-text-muted hover:text-text-main text-[9px] px-1.5 py-0.5 rounded border border-border-subtle/30 transition-all select-none cursor-pointer duration-150"
        >
          {copied ? "✓ Copied" : "📋 Copy"}
        </button>
      )}
      <pre className={`m-0 whitespace-pre-wrap break-all ${!hasData || isEmpty ? "text-text-secondary/60 italic" : ""}`}>
        {displayVal}
      </pre>
    </div>
  );
}
