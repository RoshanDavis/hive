import { useEffect, useState } from "react";
import type { McpServerConfig } from "@/services/api";
import { formInputClass, formLabelClass, segmentedButtonClass } from "@/components/shared/FormField";
import CredentialPicker from "./CredentialPicker";

interface McpConnectionFieldsProps {
  value: McpServerConfig;
  onChange: (next: McpServerConfig) => void;
  /** Workspace the server is authored in (or null at global scope). Threaded so the
   * credential picker can offer workspace-scoped credentials. */
  workspacePath?: string | null;
}

/** One non-empty trimmed entry per line. */
export function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Parse `KEY<sep>VALUE` lines into a map (first `sep` splits; blank keys dropped). */
export function parsePairs(text: string, sep: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(sep);
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + sep.length).trim();
    if (key) out[key] = val;
  }
  return out;
}

/** Serialize a map back into `KEY<sep>VALUE` lines (inverse of {@link parsePairs}). */
export function serializePairs(obj: Record<string, string> | undefined, sep: string): string {
  if (!obj) return "";
  return Object.entries(obj)
    .map(([k, v]) => `${k}${sep}${v}`)
    .join("\n");
}

/**
 * Editor for an MCP server's connection config, shared by the create form and the
 * config modal. The connection itself is stored on disk and read server-side at
 * run time — this only edits the persisted `ToolDef.mcp` blob; no command is ever
 * sent from the renderer at execution. Keeps local text state for the multiline
 * fields (seeded once) and emits a normalized `McpServerConfig` on every change.
 */
export default function McpConnectionFields({
  value,
  onChange,
  workspacePath = null,
}: McpConnectionFieldsProps) {
  const [transport, setTransport] = useState<"stdio" | "http">(
    value.transport === "http" ? "http" : "stdio"
  );
  const [command, setCommand] = useState(value.command ?? "");
  const [argsText, setArgsText] = useState((value.args ?? []).join("\n"));
  const [envText, setEnvText] = useState(serializePairs(value.env, "="));
  const [url, setUrl] = useState(value.url ?? "");
  const [headersText, setHeadersText] = useState(serializePairs(value.headers, ": "));
  // Vault credential: injected server-side at connect time (env var for stdio, the
  // Authorization header for http), so the secret never lives in tools.json.
  const [credentialId, setCredentialId] = useState<string | null>(value.credentialId ?? null);
  const [credentialEnv, setCredentialEnv] = useState(value.credentialEnv ?? "API_KEY");
  const [credentialPrefix, setCredentialPrefix] = useState(value.credentialPrefix ?? "Bearer ");

  // Emit a normalized config whenever a field changes. `onChange` is intentionally
  // omitted from deps: the parent stores the emitted value but doesn't feed it back
  // into our local state (seeded once), so there's no update loop.
  useEffect(() => {
    const cred = credentialId
      ? transport === "stdio"
        ? { credentialId, credentialEnv: credentialEnv.trim() || undefined }
        : { credentialId, credentialPrefix }
      : {};
    const next: McpServerConfig =
      transport === "stdio"
        ? {
            transport: "stdio",
            command: command.trim() || undefined,
            args: parseLines(argsText),
            env: parsePairs(envText, "="),
            ...cred,
          }
        : {
            transport: "http",
            url: url.trim() || undefined,
            headers: parsePairs(headersText, ":"),
            ...cred,
          };
    onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, command, argsText, envText, url, headersText, credentialId, credentialEnv, credentialPrefix]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className={formLabelClass}>Transport</label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setTransport("stdio")} className={segmentedButtonClass(transport === "stdio")}>
            ⌨ stdio (local process)
          </button>
          <button type="button" onClick={() => setTransport("http")} className={segmentedButtonClass(transport === "http")}>
            🌐 HTTP (streamable)
          </button>
        </div>
      </div>

      {transport === "stdio" ? (
        <>
          <div className="flex flex-col gap-1">
            <label className={formLabelClass}>Command</label>
            <input
              className={formInputClass}
              type="text"
              value={command}
              placeholder="e.g. npx"
              onChange={(e) => setCommand(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={formLabelClass}>Arguments (one per line)</label>
            <textarea
              className={`${formInputClass} font-mono`}
              rows={3}
              value={argsText}
              placeholder={"-y\n@modelcontextprotocol/server-everything"}
              onChange={(e) => setArgsText(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={formLabelClass}>Environment (KEY=VALUE per line, optional)</label>
            <textarea
              className={`${formInputClass} font-mono`}
              rows={2}
              value={envText}
              placeholder="API_KEY=..."
              onChange={(e) => setEnvText(e.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <label className={formLabelClass}>Server URL</label>
            <input
              className={formInputClass}
              type="text"
              value={url}
              placeholder="https://example.com/mcp"
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={formLabelClass}>Headers (Header: value per line, optional)</label>
            <textarea
              className={`${formInputClass} font-mono`}
              rows={2}
              value={headersText}
              placeholder="Authorization: Bearer ..."
              onChange={(e) => setHeadersText(e.target.value)}
            />
          </div>
        </>
      )}

      {/* Credential (optional): kept in the vault, injected server-side at connect
          time so the secret never lands in tools.json. */}
      <div className="flex flex-col gap-1 border-t border-border-subtle pt-3">
        <label className={formLabelClass}>Credential (optional, kept in the vault)</label>
        <CredentialPicker
          schemaTypes={["apiToken"]}
          selectedCredentialId={credentialId}
          onSelect={setCredentialId}
          workspacePath={workspacePath}
          allowOtherTypes
        />
        {credentialId && transport === "stdio" && (
          <div className="flex flex-col gap-1 mt-1">
            <label className={formLabelClass}>Inject into environment variable</label>
            <input
              className={`${formInputClass} font-mono`}
              type="text"
              value={credentialEnv}
              placeholder="API_KEY"
              onChange={(e) => setCredentialEnv(e.target.value)}
            />
          </div>
        )}
        {credentialId && transport === "http" && (
          <div className="flex flex-col gap-1 mt-1">
            <label className={formLabelClass}>Authorization value prefix</label>
            <input
              className={`${formInputClass} font-mono`}
              type="text"
              value={credentialPrefix}
              placeholder="Bearer "
              onChange={(e) => setCredentialPrefix(e.target.value)}
            />
            <span className="text-[11px] text-text-muted">
              Sent as the <code>Authorization</code> header (<code>{credentialPrefix}…</code>).
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
