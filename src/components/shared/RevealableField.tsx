import { useState } from "react";

interface RevealableFieldProps {
  type: "password" | "text" | "url";
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

// Text/url inputs render plainly. Password inputs render masked by default with
// an eye toggle on the right that swaps to a plaintext input on click.
export default function RevealableField({
  type,
  value,
  onChange,
  placeholder,
  disabled,
}: RevealableFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && !revealed ? "password" : "text";

  return (
    <div className="relative">
      <input
        type={inputType}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full bg-input border border-border-subtle rounded-md px-2 py-1.5 text-xs text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none ${
          isPassword ? "pr-8" : ""
        }`}
      />
      {isPassword && (
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          tabIndex={-1}
          aria-label={revealed ? "Hide value" : "Show value"}
          title={revealed ? "Hide" : "Show"}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main bg-transparent border-none cursor-pointer leading-none p-0.5 text-xs select-none"
        >
          {revealed ? "🙈" : "👁"}
        </button>
      )}
    </div>
  );
}
