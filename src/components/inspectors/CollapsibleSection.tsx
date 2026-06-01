import { useState, useId, type ReactNode } from "react";

interface CollapsibleSectionProps {
  title: string;
  icon: string;
  defaultOpen?: boolean;
  badge?: string | number;
  /** When true, the section fills available vertical space inside a flex-column
   * parent (used by JSONStorageInspector whose primary content is a table that
   * should fill the panel height). When closed, the outer wrapper drops
   * `flex-1` so the card collapses to header height. */
  grow?: boolean;
  /** When true, the content area drops its inner padding so children render
   * edge-to-edge of the card border. Used by ConnectionInspector's Live
   * Connection Data section. Ignored when `grow` is also set. */
  flush?: boolean;
  children: ReactNode;
}

export default function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  badge,
  grow = false,
  flush = false,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();

  const outerClass = grow
    ? `border border-border-subtle rounded-lg overflow-hidden bg-card/40 flex flex-col min-h-0${
        isOpen ? " flex-1" : ""
      }`
    // shrink-0: keep the section at its natural content height inside a
    // flex-column scroll container. Without this, the inspector body's
    // flex layout shrinks every section proportionally when their combined
    // content exceeds the visible area, clipping each card's inner content
    // instead of triggering the body's overflow-y-auto scroll.
    : "border border-border-subtle rounded-lg overflow-hidden bg-card/40 shrink-0";

  return (
    <div className={outerClass}>
      <button
        className="w-full flex items-center gap-2.5 px-3.5 py-3 bg-card hover:bg-card-hover transition-colors cursor-pointer select-none border-none outline-none shrink-0"
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

      {grow ? (
        <div
          id={contentId}
          className={
            isOpen
              ? "flex-1 flex flex-col min-h-0 overflow-hidden"
              : "h-0 overflow-hidden"
          }
        >
          <div className="p-3.5 pt-1 flex-1 flex flex-col min-h-0">{children}</div>
        </div>
      ) : (
        <div
          id={contentId}
          className="collapsible-content"
          style={{
            gridTemplateRows: isOpen ? "1fr" : "0fr",
          }}
        >
          <div className="overflow-hidden">
            {flush ? children : <div className="p-3.5 pt-1">{children}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
