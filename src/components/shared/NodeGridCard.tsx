import type { ReactNode } from "react";

interface NodeGridCardProps {
  icon: string;
  label: string;
  /** Plugin accent color — drives the icon glow and optional bottom stripe. */
  color: string;
  /** Tooltip text. */
  title?: string;
  onClick: () => void;
  /** When provided, a ✕ button appears top-right on hover. */
  onClear?: () => void;
  clearTitle?: string;
  /** Small text rendered under the label. */
  subtitle?: ReactNode;
  /** Bottom accent stripe (used on the landing-page Nodes tab). */
  showStripe?: boolean;
}

/** Square, clickable node card shared by the Nodes tab and the workspace defaults panel. */
export default function NodeGridCard({
  icon,
  label,
  color,
  title,
  onClick,
  onClear,
  clearTitle = "Remove",
  subtitle,
  showStripe = false,
}: NodeGridCardProps) {
  return (
    <div className="relative group aspect-square">
      {onClear && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="absolute top-2 right-2 z-10 text-text-muted hover:text-[#ff6b6b] hover:bg-[rgba(255,107,107,0.1)] w-6 h-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          title={clearTitle}
        >
          ✕
        </button>
      )}
      <button
        type="button"
        onClick={onClick}
        className="bg-card rounded-xl p-4 border border-border-card shadow-card flex flex-col items-center justify-center w-full h-full cursor-pointer transition-all duration-250 hover:bg-card-hover hover:-translate-y-1 hover:shadow-card-hover hover:border-accent-dim"
        title={title}
      >
        <span
          className="text-4xl mb-2 transition-transform group-hover:scale-110"
          style={{ filter: `drop-shadow(0 0 8px ${color}55)` }}
        >
          {icon}
        </span>
        <span className="text-xs font-semibold text-text-main text-center">{label}</span>
        {subtitle && (
          <span className="text-[10px] text-text-muted mt-1 text-center">{subtitle}</span>
        )}
        {showStripe && (
          <span
            className="absolute bottom-0 left-0 right-0 h-1 rounded-b-xl"
            style={{ background: color, opacity: 0.5 }}
          />
        )}
      </button>
    </div>
  );
}
