import CredentialGrantList from "@/components/customNodes/CredentialGrantList";
import { formLabelClass } from "@/components/shared/FormField";
import type { HandleConfig } from "@/engine/plugin";
import type {
  CustomNodeScope,
  NetworkGrant,
  ScriptField,
  ScriptLimits,
} from "@/types/customNodes";

/**
 * Script branch of CustomNodeFormModal: the sandbox limits, network grant,
 * credential grants, config-field builder, and handles editor. Purely
 * presentational — all state lives in the parent modal.
 */
interface ScriptNodeFormProps {
  editing: boolean;
  scriptEntry: string;
  opening: boolean;
  openScriptInEditor: () => void;

  limits: ScriptLimits;
  setLimits: React.Dispatch<React.SetStateAction<ScriptLimits>>;

  network: NetworkGrant;
  setNetwork: React.Dispatch<React.SetStateAction<NetworkGrant>>;
  /** Tri-state derived from `network`: which UI button is active. */
  netMode: "none" | "all" | "allowlist";

  credentials: string[];
  setCredentials: React.Dispatch<React.SetStateAction<string[]>>;

  configSchema: ScriptField[];
  setConfigSchema: React.Dispatch<React.SetStateAction<ScriptField[]>>;

  handles: HandleConfig[];
  setHandles: React.Dispatch<React.SetStateAction<HandleConfig[]>>;

  workspacePath: string | null;
  scope: CustomNodeScope;
}

export default function ScriptNodeForm({
  editing,
  scriptEntry,
  opening,
  openScriptInEditor,
  limits,
  setLimits,
  network,
  setNetwork,
  netMode,
  credentials,
  setCredentials,
  configSchema,
  setConfigSchema,
  handles,
  setHandles,
  workspacePath,
}: ScriptNodeFormProps) {
  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
      <span className={formLabelClass}>Script</span>
      <p className="text-[11px] text-text-muted leading-relaxed m-0">
        Behavior comes from <span className="font-mono">{scriptEntry}</span> in this
        node's folder. The code runs in a sandboxed QuickJS runtime in Rust; network
        access is governed by the Network grant below. The file is the body of{" "}
        <span className="font-mono">(ctx) =&gt; {"{ … }"}</span>; return a string or an
        envelope.
      </p>

      {editing ? (
        <button
          type="button"
          onClick={openScriptInEditor}
          disabled={opening}
          className="self-start text-[11px] text-text-muted hover:text-accent border border-border-subtle hover:border-accent-dim rounded-md px-2.5 py-1.5 cursor-pointer bg-card hover:bg-card-hover transition-colors flex items-center gap-1 disabled:opacity-50"
        >
          <span>📝</span>
          <span>{opening ? "Opening…" : "Open script in editor"}</span>
        </button>
      ) : (
        <p className="text-[11px] text-text-muted/80 italic m-0">
          A starter <span className="font-mono">script.js</span> is created and revealed
          in your file manager when you click Create.
        </p>
      )}

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <label className={formLabelClass}>Timeout (ms)</label>
          <input
            type="number"
            min={50}
            max={10000}
            value={limits.timeoutMs}
            onChange={(e) =>
              setLimits((l) => ({ ...l, timeoutMs: Number(e.target.value) || 0 }))
            }
            className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main outline-none focus:border-accent-dim"
          />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <label className={formLabelClass}>Memory (MB)</label>
          <input
            type="number"
            min={1}
            max={64}
            value={Math.round(limits.memoryBytes / (1024 * 1024))}
            onChange={(e) =>
              setLimits((l) => ({
                ...l,
                memoryBytes: (Number(e.target.value) || 0) * 1024 * 1024,
              }))
            }
            className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main outline-none focus:border-accent-dim"
          />
        </div>
      </div>
      <p className="text-[10px] text-text-muted/70 m-0">
        Limits are clamped server-side (timeout ≤ 10s, memory ≤ 64 MB).
      </p>

      {/* Network grant */}
      <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
        <label className={formLabelClass}>Network</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setNetwork({ mode: "none", allow: [] })}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold border cursor-pointer transition-colors ${
              netMode === "none"
                ? "bg-accent/30 border-accent/50 text-text-main"
                : "bg-card border-border-subtle text-text-muted hover:text-text-main"
            }`}
          >
            🚫 None
          </button>
          <button
            type="button"
            onClick={() => setNetwork({ mode: "allowlist", allow: ["*"] })}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold border cursor-pointer transition-colors ${
              netMode === "all"
                ? "bg-accent/30 border-accent/50 text-text-main"
                : "bg-card border-border-subtle text-text-muted hover:text-text-main"
            }`}
          >
            🌐 Allow all
          </button>
          <button
            type="button"
            onClick={() =>
              setNetwork((n) => ({
                mode: "allowlist",
                // Coming from Allow-all, start a fresh list instead of keeping "*".
                allow:
                  n.allow.length === 1 && n.allow[0].trim() === "*" ? [] : n.allow,
              }))
            }
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold border cursor-pointer transition-colors ${
              netMode === "allowlist"
                ? "bg-accent/30 border-accent/50 text-text-main"
                : "bg-card border-border-subtle text-text-muted hover:text-text-main"
            }`}
          >
            📝 Allowlist
          </button>
        </div>

        {netMode === "all" && (
          <p className="text-[10px] text-text-muted/70 m-0">
            All public hosts allowed. Private/loopback addresses (localhost, 127.0.0.1,
            LAN) stay blocked — switch to Allowlist and list them exactly to reach them.
          </p>
        )}

        {netMode === "allowlist" && (
          <div className="flex flex-col gap-1.5">
            {network.allow.map((host, i) => (
              <div key={i} className="flex gap-1.5">
                <input
                  type="text"
                  value={host}
                  placeholder="api.example.com or *.example.com"
                  onChange={(e) =>
                    setNetwork((n) => {
                      const allow = [...n.allow];
                      allow[i] = e.target.value;
                      return { ...n, allow };
                    })
                  }
                  className="flex-1 bg-input border border-border-subtle rounded-md px-3 py-1.5 text-sm text-text-main outline-none focus:border-accent-dim font-mono"
                />
                <button
                  type="button"
                  onClick={() =>
                    setNetwork((n) => ({
                      ...n,
                      allow: n.allow.filter((_, j) => j !== i),
                    }))
                  }
                  className="text-text-muted hover:text-danger border border-border-subtle rounded-md px-2 cursor-pointer bg-card hover:bg-card-hover"
                  title="Remove host"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setNetwork((n) => ({ ...n, allow: [...n.allow, ""] }))}
              className="self-start text-[11px] text-text-muted hover:text-accent border border-dashed border-border-subtle hover:border-accent-dim rounded-md px-2 py-1 cursor-pointer bg-transparent transition-colors"
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

      {/* Credential grants */}
      <CredentialGrantList
        granted={credentials}
        onChange={setCredentials}
        workspacePath={workspacePath}
      />

      {/* Config fields builder */}
      <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
        <label className={formLabelClass}>Config fields</label>
        {configSchema.map((field, i) => (
          <div
            key={i}
            className="flex flex-col gap-1.5 bg-input/40 border border-border-subtle rounded-md p-2"
          >
            <div className="flex gap-1.5">
              <input
                type="text"
                value={field.key}
                placeholder="key"
                onChange={(e) =>
                  setConfigSchema((s) =>
                    s.map((f, j) => (j === i ? { ...f, key: e.target.value } : f))
                  )
                }
                className="w-28 bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim font-mono"
              />
              <input
                type="text"
                value={field.label}
                placeholder="Label"
                onChange={(e) =>
                  setConfigSchema((s) =>
                    s.map((f, j) => (j === i ? { ...f, label: e.target.value } : f))
                  )
                }
                className="flex-1 bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim"
              />
              <button
                type="button"
                onClick={() => setConfigSchema((s) => s.filter((_, j) => j !== i))}
                className="text-text-muted hover:text-danger border border-border-subtle rounded-md px-2 cursor-pointer bg-card hover:bg-card-hover"
                title="Remove field"
              >
                ×
              </button>
            </div>
            <div className="flex gap-1.5 items-center">
              <select
                value={field.type}
                onChange={(e) =>
                  setConfigSchema((s) =>
                    s.map((f, j) =>
                      j === i ? { ...f, type: e.target.value as ScriptField["type"] } : f
                    )
                  )
                }
                className="bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim"
              >
                {(["string", "number", "boolean", "select", "password"] as const).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-[11px] text-text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={Boolean(field.required)}
                  onChange={(e) =>
                    setConfigSchema((s) =>
                      s.map((f, j) => (j === i ? { ...f, required: e.target.checked } : f))
                    )
                  }
                  className="w-3 h-3 cursor-pointer"
                />
                required
              </label>
              {field.type === "select" && (
                <input
                  type="text"
                  value={(field.options ?? []).join(", ")}
                  placeholder="option1, option2"
                  onChange={(e) =>
                    setConfigSchema((s) =>
                      s.map((f, j) =>
                        j === i
                          ? {
                              ...f,
                              options: e.target.value
                                .split(",")
                                .map((o) => o.trim())
                                .filter(Boolean),
                            }
                          : f
                      )
                    )
                  }
                  className="flex-1 bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim"
                />
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setConfigSchema((s) => [...s, { key: "", label: "", type: "string" }])
          }
          className="self-start text-[11px] text-text-muted hover:text-accent border border-dashed border-border-subtle hover:border-accent-dim rounded-md px-2 py-1 cursor-pointer bg-transparent transition-colors"
        >
          ＋ Add field
        </button>
        <p className="text-[10px] text-text-muted/70 m-0">
          Fields appear in the node inspector and are passed to the script as{" "}
          <span className="font-mono">ctx.config</span> (keyed by <span className="font-mono">key</span>).
        </p>
      </div>

      {/* Handles editor */}
      <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
        <label className={formLabelClass}>Handles</label>
        {handles.map((h, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <input
              type="text"
              value={h.id ?? ""}
              placeholder="id (optional)"
              onChange={(e) =>
                setHandles((hs) =>
                  hs.map((x, j) => (j === i ? { ...x, id: e.target.value } : x))
                )
              }
              className="flex-1 bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim font-mono"
            />
            <select
              value={h.type}
              onChange={(e) =>
                setHandles((hs) =>
                  hs.map((x, j) =>
                    j === i ? { ...x, type: e.target.value as HandleConfig["type"] } : x
                  )
                )
              }
              className="bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim"
            >
              <option value="target">target (in)</option>
              <option value="source">source (out)</option>
            </select>
            <select
              value={h.position}
              onChange={(e) =>
                setHandles((hs) =>
                  hs.map((x, j) =>
                    j === i
                      ? { ...x, position: e.target.value as HandleConfig["position"] }
                      : x
                  )
                )
              }
              className="bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim"
            >
              {(["left", "right", "top", "bottom"] as const).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setHandles((hs) => hs.filter((_, j) => j !== i))}
              className="text-text-muted hover:text-danger border border-border-subtle rounded-md px-2 cursor-pointer bg-card hover:bg-card-hover"
              title="Remove handle"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setHandles((hs) => [...hs, { type: "target", position: "left" }])
          }
          className="self-start text-[11px] text-text-muted hover:text-accent border border-dashed border-border-subtle hover:border-accent-dim rounded-md px-2 py-1 cursor-pointer bg-transparent transition-colors"
        >
          ＋ Add handle
        </button>
        <p className="text-[10px] text-text-muted/70 m-0">
          Leave empty for the default one input (left) + one output (right).
        </p>
      </div>
    </div>
  );
}
