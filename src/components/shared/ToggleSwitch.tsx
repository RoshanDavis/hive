interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Native tooltip text. */
  title?: string;
  disabled?: boolean;
  /** Accessible label when there's no adjacent visible text label. */
  ariaLabel?: string;
}

/**
 * The app's pill toggle (knob slides on a track). One source of truth for the
 * switch used across Settings (concurrency pools), the Agent inspector (round
 * limit), and the LLM config (history). Controlled: pass `checked` + `onChange`.
 */
export default function ToggleSwitch({
  checked,
  onChange,
  title,
  disabled,
  ariaLabel,
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 border-none flex items-center ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      } ${checked ? "bg-accent" : "bg-input"}`}
    >
      <div
        className={`w-4 h-4 rounded-full bg-toggle-knob shadow-md transform duration-200 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
