import type { NetworkGrant } from "@/types/customNodes";
import { formLabelClass } from "@/components/shared/FormField";

interface NetworkAllowlistEditorProps {
  value: NetworkGrant;
  onChange: (next: NetworkGrant) => void;
  /** Section heading (default "Network"). */
  label?: string;
}

/** Which tri-state button is active, derived from the grant. */
function deriveMode(value: NetworkGrant): "none" | "all" | "allowlist" {
  if (value.mode === "none") return "none";
  const isAll = value.allow.length === 1 && value.allow[0].trim() === "*";
  return isAll ? "all" : "allowlist";
}

const modeButtonClass = (active: boolean) =>
  `flex-1 rounded-md px-3 py-1.5 text-xs font-semibold border cursor-pointer transition-colors ${
    active
      ? "bg-accent/30 border-accent/50 text-text-main"
      : "bg-card border-border-subtle text-text-muted hover:text-text-main"
  }`;

/**
 * None / Allow-all / Allowlist editor for a {@link NetworkGrant}, shared by custom
 * script nodes and custom HTTP/script tools so the "allowed hosts" UI is identical
 * everywhere. The grant is enforced server-side (SSRF-guarded fetch); this only
 * edits the persisted shape. Operates on `value` + `onChange` (controlled).
 */
export default function NetworkAllowlistEditor({
  value,
  onChange,
  label = "Network",
}: NetworkAllowlistEditorProps) {
  const mode = deriveMode(value);

  const setHost = (i: number, host: string) => {
    const allow = [...value.allow];
    allow[i] = host;
    onChange({ ...value, allow });
  };

  return (
    <div className="flex flex-col gap-2">
      <label className={formLabelClass}>{label}</label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange({ mode: "none", allow: [] })}
          className={modeButtonClass(mode === "none")}
        >
          🚫 None
        </button>
        <button
          type="button"
          onClick={() => onChange({ mode: "allowlist", allow: ["*"] })}
          className={modeButtonClass(mode === "all")}
        >
          🌐 Allow all
        </button>
        <button
          type="button"
          onClick={() =>
            onChange({
              mode: "allowlist",
              // Coming from Allow-all, start a fresh list instead of keeping "*".
              allow: value.allow.length === 1 && value.allow[0].trim() === "*" ? [] : value.allow,
            })
          }
          className={modeButtonClass(mode === "allowlist")}
        >
          📝 Allowlist
        </button>
      </div>

      {mode === "all" && (
        <p className="text-[10px] text-text-muted/70 m-0">
          All public hosts allowed. Private/loopback addresses (localhost, 127.0.0.1,
          LAN) stay blocked — switch to Allowlist and list them exactly to reach them.
        </p>
      )}

      {mode === "allowlist" && (
        <div className="flex flex-col gap-1.5">
          {value.allow.map((host, i) => (
            <div key={i} className="flex gap-1.5">
              <input
                type="text"
                value={host}
                placeholder="api.example.com or *.example.com"
                onChange={(e) => setHost(i, e.target.value)}
                className="flex-1 bg-input border border-border-subtle rounded-md px-3 py-1.5 text-sm text-text-main outline-none focus:border-accent-dim font-mono"
              />
              <button
                type="button"
                onClick={() => onChange({ ...value, allow: value.allow.filter((_, j) => j !== i) })}
                className="text-text-muted hover:text-danger border border-border-subtle rounded-md px-2 cursor-pointer bg-card hover:bg-card-hover"
                title="Remove host"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...value, allow: [...value.allow, ""] })}
            className="self-start text-[11px] text-text-muted hover:text-text-main border border-dashed border-border-subtle hover:border-border-card rounded-md px-2 py-1 cursor-pointer bg-transparent transition-colors"
          >
            ＋ Add host
          </button>
          <p className="text-[10px] text-text-muted/70 m-0">
            Hosts only (no path). Private/loopback addresses are blocked unless listed
            exactly, and hosts that resolve into a private range are refused at connect time.
          </p>
        </div>
      )}
    </div>
  );
}
