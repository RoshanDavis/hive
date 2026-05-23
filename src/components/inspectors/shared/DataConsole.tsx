import { useState } from "react";

interface DataConsoleProps {
  content: string | null | undefined;
  placeholder?: string;
}

export default function DataConsole({ content, placeholder = "No data transmitted yet." }: DataConsoleProps) {
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
    <div className="bg-[#0b0b0d]/70 border border-[#222] rounded-lg p-3 font-mono text-[11px] leading-relaxed text-[#e4e4e7] overflow-x-auto relative group max-h-35 overflow-y-auto pr-10 scrollbar-thin select-text">
      {hasData && !isEmpty && (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 hover:bg-[#1e1e24] text-[#a1a1aa] hover:text-white text-[9px] px-1.5 py-0.5 rounded border border-[#2e2e38]/30 transition-all select-none cursor-pointer duration-150"
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
