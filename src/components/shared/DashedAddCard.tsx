interface DashedAddCardProps {
  label: string;
  onClick: () => void;
  title?: string;
  /** Highlight state, e.g. while its picker menu is open. */
  active?: boolean;
}

/** Square dashed-border "add" card shared by node grids. */
export default function DashedAddCard({ label, onClick, title, active = false }: DashedAddCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`bg-transparent border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center aspect-square cursor-pointer transition-all duration-250 hover:border-accent hover:bg-accent-glow hover:text-accent group ${
        active ? "border-accent bg-accent-glow" : "border-border-card"
      }`}
      title={title}
    >
      <span
        className={`text-3xl transition-colors mb-1 ${
          active ? "text-accent" : "text-text-secondary group-hover:text-accent"
        }`}
      >
        ＋
      </span>
      <span
        className={`text-xs font-medium text-center transition-colors ${
          active ? "text-accent" : "text-text-secondary group-hover:text-accent"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
