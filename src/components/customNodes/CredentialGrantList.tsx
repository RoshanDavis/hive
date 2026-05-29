import { useCallback, useEffect, useMemo, useState } from "react";
import { credentialService } from "@/services/credentialService";
import { pluginRegistry } from "@/engine/pluginRegistry";
import AddCredentialMiniForm from "@/components/inspectors/shared/AddCredentialMiniForm";
import type { CredentialMeta, CredentialScope } from "@/types/credentialTypes";
import { formLabelClass } from "@/components/shared/FormField";

interface Props {
  /** Currently granted credential ids. */
  granted: string[];
  onChange: (next: string[]) => void;
  /**
   * Workspace the grants are authored in, or null at global scope (only global
   * credentials are then offered). Mirrors the credential service's scope rules.
   */
  workspacePath: string | null;
}

const SCOPE_ICON: Record<CredentialScope, string> = { global: "🌐", local: "📁" };

/**
 * Multi-grant credential editor for script nodes: a removable list of granted
 * credentials, a scope-grouped dropdown to grant existing ones, and an inline
 * "add new" form (reusing {@link AddCredentialMiniForm}) for creating one on the spot.
 * Scales past the old all-credentials checklist when many credentials exist.
 */
export default function CredentialGrantList({ granted, onChange, workspacePath }: Props) {
  const [available, setAvailable] = useState<CredentialMeta[]>([]);
  const [addNewOpen, setAddNewOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await credentialService.list(workspacePath ?? undefined);
      setAvailable(list);
    } catch {
      setAvailable([]);
    }
  }, [workspacePath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A script can inject any provider's key as a header, so offer every schema here.
  const allSchemas = useMemo(() => pluginRegistry.getCredentialSchemas(), []);

  const grantedSet = useMemo(() => new Set(granted), [granted]);
  const resolved = useMemo(
    () => available.filter((c) => grantedSet.has(c.id)),
    [available, grantedSet]
  );
  const dangling = useMemo(
    () => granted.filter((id) => !available.some((c) => c.id === id)),
    [granted, available]
  );
  const ungranted = useMemo(
    () => available.filter((c) => !grantedSet.has(c.id)),
    [available, grantedSet]
  );
  const ungrantedByScope = useMemo(() => {
    const groups: Record<CredentialScope, CredentialMeta[]> = { global: [], local: [] };
    for (const c of ungranted) groups[c.scope].push(c);
    return groups;
  }, [ungranted]);

  const grant = (id: string) => {
    if (id && !grantedSet.has(id)) onChange([...granted, id]);
  };
  const revoke = (id: string) => onChange(granted.filter((x) => x !== id));

  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
      <label className={formLabelClass}>
        Credential grants
      </label>

      {resolved.length === 0 && dangling.length === 0 && (
        <p className="text-[11px] text-text-muted/80 italic m-0">No credentials granted yet.</p>
      )}

      {resolved.map((c) => (
        <div
          key={c.id}
          className="flex items-center gap-2 bg-input/40 border border-border-subtle rounded-md px-2 py-1.5"
        >
          <span>{SCOPE_ICON[c.scope]}</span>
          <span className="text-xs text-text-main truncate">{c.name}</span>
          <span className="text-[11px] text-text-muted/70">({c.provider})</span>
          <button
            type="button"
            onClick={() => revoke(c.id)}
            className="ml-auto text-text-muted hover:text-danger border border-border-subtle rounded px-1.5 cursor-pointer bg-card hover:bg-card-hover text-[11px]"
            title="Revoke grant"
          >
            ×
          </button>
        </div>
      ))}

      {dangling.length > 0 && (
        <div className="flex flex-col gap-1 bg-amber-500/10 border border-amber-500/30 rounded-md p-2">
          <span className="text-[10px] uppercase tracking-widest font-bold text-amber-400">
            ⚠️ Granted but unavailable here
          </span>
          {dangling.map((id) => (
            <div key={id} className="flex items-center gap-2">
              <span className="flex-1 text-[10px] font-mono text-amber-300/90 truncate">{id}</span>
              <button
                type="button"
                onClick={() => revoke(id)}
                className="text-text-muted hover:text-danger border border-border-subtle rounded px-1.5 cursor-pointer bg-card hover:bg-card-hover text-[11px]"
                title="Revoke grant"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {addNewOpen ? (
        <AddCredentialMiniForm
          acceptedSchemas={allSchemas}
          workspacePath={workspacePath}
          onCancel={() => setAddNewOpen(false)}
          onCreated={(meta) => {
            grant(meta.id);
            setAddNewOpen(false);
            refresh();
          }}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {ungranted.length > 0 ? (
            <select
              value=""
              onChange={(e) => grant(e.target.value)}
              className="w-full bg-input border border-border-subtle rounded-md px-3 py-1.5 text-xs text-text-main outline-none focus:border-accent-dim cursor-pointer"
            >
              <option value="">＋ Grant an existing credential…</option>
              {ungrantedByScope.global.length > 0 && (
                <optgroup label="🌐 Global">
                  {ungrantedByScope.global.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.provider})
                    </option>
                  ))}
                </optgroup>
              )}
              {ungrantedByScope.local.length > 0 && (
                <optgroup label="📁 Workspace">
                  {ungrantedByScope.local.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.provider})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          ) : (
            <p className="text-[11px] text-text-muted/80 italic m-0">
              No more credentials available at this scope to grant.
            </p>
          )}
          <button
            type="button"
            onClick={() => setAddNewOpen(true)}
            className="self-start text-[11px] text-text-muted hover:text-accent border border-dashed border-border-subtle hover:border-accent-dim rounded-md px-2 py-1 cursor-pointer bg-transparent transition-colors"
          >
            ＋ Add new credential
          </button>
        </div>
      )}

      <p className="text-[10px] text-text-muted/70 m-0">
        The script names a granted credential by id; Rust injects the key as a header — the
        secret never enters the script. Credential ids are machine-specific and don't travel
        when a node is promoted/exported.
      </p>
    </div>
  );
}
