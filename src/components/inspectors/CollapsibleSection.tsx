import { useState, useId } from "react";

interface CollapsibleSectionProps {
  title: string;
  icon: string;
  defaultOpen?: boolean;
  badge?: string | number;
  children: React.ReactNode;
}

export default function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  badge,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className="border border-border-subtle rounded-lg overflow-hidden bg-card/40">
      <button
        className="w-full flex items-center gap-2.5 px-3.5 py-3 bg-card hover:bg-card-hover transition-colors cursor-pointer select-none border-none outline-none"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <span className="text-base leading-none">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-widest text-text-main flex-1 text-left">
          {title}
        </span>
        {badge !== undefined && (
          <span className="text-[10px] font-bold text-accent bg-accent-glow px-1.5 py-0.5 rounded-sm">
            {badge}
          </span>
        )}
        <span
          className="text-text-muted text-[10px] transition-transform duration-200"
          style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          ▼
        </span>
      </button>

      <div
        id={contentId}
        className="collapsible-content"
        style={{
          gridTemplateRows: isOpen ? "1fr" : "0fr",
        }}
      >
        <div className="overflow-hidden">
          <div className="p-3.5 pt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
