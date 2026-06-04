import { useCallback, useEffect, useMemo, useState } from "react";
import { credentialService } from "@/services/credentialService";
import { pluginRegistry } from "@/engine/pluginRegistry";
import AddCredentialMiniForm from "./AddCredentialMiniForm";
import type { CredentialMeta, CredentialScope, CredentialSchema } from "@/types/credentialTypes";
import { formLabelClass } from "@/components/shared/FormField";

interface CredentialFieldProps {
  /** Acceptable credential schema types. Empty ⇒ nothing rendered. */
  schemaTypes: string[];
  /** Currently bound credential id, or null. */
  selectedCredentialId: string | null;
  onSelect: (id: string | null) => void;
  /** Workspace scope (null ⇒ only global credentials apply). */
  workspacePath: string | null;
  /** When true, also list other-type credentials (with a mismatch warning). */
  allowOtherTypes?: boolean;
  /** Optional heading. Omit when the caller already labels the section. */
  label?: string;
}

const SCOPE_ICON: Record<CredentialScope, string> = { global: "🌐", local: "📁" };

/**
 * Single-credential picker rendered in the same grant-list style as
 * {@link CredentialGrantList} (used by script tools): a removable row when bound,
 * a scope-grouped "grant existing" dropdown + inline "add new" form when not, and a
 * dangling/mismatch warning. Use this (over the bare-dropdown `CredentialPicker`)
 * wherever a tool/MCP server needs one credential, for a consistent credential UX.
 */
export default function CredentialField({
  schemaTypes,
  selectedCredentialId,
  onSelect,
  workspacePath,
  allowOtherTypes = false,
  label,
}: CredentialFieldProps) {
  const [available, setAvailable] = useState<CredentialMeta[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setAvailable(await credentialService.list(workspacePath ?? undefined));
    } catch {
      setAvailable([]);
    }
  }, [workspacePath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const acceptedSchemas: CredentialSchema[] = useMemo(
    () => pluginRegistry.getCredentialSchemas().filter((s) => schemaTypes.includes(s.type)),
    [schemaTypes]
  );

  const matching = useMemo(
    () => available.filter((c) => schemaTypes.includes(c.schemaType)),
    [available, schemaTypes]
  );
  const others = useMemo(
    () => (allowOtherTypes ? available.filter((c) => !schemaTypes.includes(c.schemaType)) : []),
    [allowOtherTypes, available, schemaTypes]
  );

  const selected = useMemo(
    () => [...matching, ...others].find((c) => c.id === selectedCredentialId) ?? null,
    [matching, others, selectedCredentialId]
  );
  const dangling = selectedCredentialId != null && !selected;
  const mismatch = selected != null && !schemaTypes.includes(selected.schemaType);

  const byScope = useMemo(() => {
    const groups: Record<CredentialScope, CredentialMeta[]> = { global: [], local: [] };
    for (const c of matching) groups[c.scope].push(c);
    return groups;
  }, [matching]);

  if (schemaTypes.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {label && <label className={formLabelClass}>{label}</label>}

      {/* Bound credential — a removable row. */}
      {selected && (
        <div className="flex items-center gap-2 bg-input/40 border border-border-subtle rounded-md px-2 py-1.5">
          <span>{SCOPE_ICON[selected.scope]}</span>
          <span className="text-xs text-text-main truncate">{selected.name}</span>
          <span className="text-[11px] text-text-muted/70">({selected.provider})</span>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="ml-auto text-text-muted hover:text-danger border border-border-subtle rounded px-1.5 cursor-pointer bg-card hover:bg-card-hover text-[11px]"
            title="Clear credential"
          >
            ×
          </button>
        </div>
      )}

      {mismatch && (
        <p className="text-[10px] text-warning/90 bg-warning/10 border border-warning/30 rounded-md px-2 py-1 m-0">
          ⚠ This credential is a different type than expected — it may still work if it's the right
          key, but double-check.
        </p>
      )}

      {dangling && (
        <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-md px-2 py-1.5">
          <span className="flex-1 text-[10px] font-mono text-warning/90 truncate">
            {selectedCredentialId}
          </span>
          <span className="text-[10px] text-warning">missing</span>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-text-muted hover:text-danger border border-border-subtle rounded px-1.5 cursor-pointer bg-card hover:bg-card-hover text-[11px]"
            title="Clear credential"
          >
            ×
          </button>
        </div>
      )}

      {/* Pick / add when nothing is bound. */}
      {!selected &&
        (addOpen ? (
          <AddCredentialMiniForm
            acceptedSchemas={acceptedSchemas}
            workspacePath={workspacePath}
            onCancel={() => setAddOpen(false)}
            onCreated={(meta) => {
              setAddOpen(false);
              onSelect(meta.id);
              refresh();
            }}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <select
              value=""
              onChange={(e) => e.target.value && onSelect(e.target.value)}
              className="w-full bg-input border border-border-subtle rounded-md px-3 py-1.5 text-xs text-text-main outline-none focus:border-accent-dim cursor-pointer"
            >
              <option value="">＋ Select a credential…</option>
              {byScope.global.length > 0 && (
                <optgroup label="🌐 Global">
                  {byScope.global.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.provider})
                    </option>
                  ))}
                </optgroup>
              )}
              {byScope.local.length > 0 && (
                <optgroup label="📁 Workspace">
                  {byScope.local.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.provider})
                    </option>
                  ))}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label="⚠ Other types">
                  {others.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.provider})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="self-start text-[11px] text-text-muted hover:text-text-main border border-dashed border-border-subtle hover:border-border-card rounded-md px-2 py-1 cursor-pointer bg-transparent transition-colors"
            >
              ＋ Add new credential
            </button>
          </div>
        ))}
    </div>
  );
}
