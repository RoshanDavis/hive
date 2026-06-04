import { useCallback, useEffect, useMemo, useState } from "react";
import { credentialService } from "@/services/credentialService";
import { pluginRegistry } from "@/engine/pluginRegistry";
import AddCredentialMiniForm from "./AddCredentialMiniForm";
import type {
  CredentialMeta,
  CredentialScope,
  CredentialSchema,
} from "@/types/credentialTypes";
import { formLabelClass, formInputClass } from "@/components/shared/FormField";

interface CredentialPickerProps {
  /** Which credential schema types are acceptable. Empty array = no picker rendered. */
  schemaTypes: string[];
  /** Currently selected credential id, or null. */
  selectedCredentialId: string | null;
  /** Called when the user picks or clears a credential. */
  onSelect: (id: string | null) => void;
  /**
   * The workspace this picker lives in. Determines whether local credentials are
   * visible / default scope when adding. Null in workspace-less contexts (e.g. the
   * landing-page global node-defaults editor), where only global credentials apply.
   */
  workspacePath: string | null;
}

const SCOPE_LABEL: Record<CredentialScope, string> = {
  global: "🌐 Global",
  local: "📁 Workspace",
};

export default function CredentialPicker({
  schemaTypes,
  selectedCredentialId,
  onSelect,
  workspacePath,
}: CredentialPickerProps) {
  const [credentials, setCredentials] = useState<CredentialMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Schemas the inspector accepts, in display order.
  const acceptedSchemas: CredentialSchema[] = useMemo(() => {
    const all = pluginRegistry.getCredentialSchemas();
    return all.filter((s) => schemaTypes.includes(s.type));
  }, [schemaTypes]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Null workspacePath → backend returns global credentials only, which is
      // exactly the safe subset for a workspace-less (global) context.
      const list = await credentialService.list(workspacePath ?? undefined);
      setCredentials(list);
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Restrict the visible options to those matching the accepted schema types.
  const matchingCredentials = useMemo(
    () => credentials.filter((c) => schemaTypes.includes(c.schemaType)),
    [credentials, schemaTypes]
  );

  const grouped = useMemo(() => {
    const groups: Record<CredentialScope, CredentialMeta[]> = {
      global: [],
      local: [],
    };
    for (const c of matchingCredentials) {
      groups[c.scope].push(c);
    }
    return groups;
  }, [matchingCredentials]);

  const selectedExists = useMemo(
    () =>
      selectedCredentialId == null ||
      matchingCredentials.some((c) => c.id === selectedCredentialId),
    [matchingCredentials, selectedCredentialId]
  );

  // If a credential is selected but doesn't exist (deleted, wrong scope, etc.),
  // we render a red "missing" row instead of silently dropping the selection.
  const showMissingBanner =
    !loading && selectedCredentialId != null && !selectedExists;

  if (schemaTypes.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 animate-[fadeIn_0.15s_ease-out]">
      <label className={formLabelClass}>
        Credential
      </label>

      <select
        className={`${formInputClass} cursor-pointer`}
        value={selectedCredentialId ?? ""}
        onChange={(e) => onSelect(e.target.value || null)}
      >
        <option value="">— Select a credential —</option>
        {grouped.global.length > 0 && (
          <optgroup label={SCOPE_LABEL.global}>
            {grouped.global.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.provider})
              </option>
            ))}
          </optgroup>
        )}
        {grouped.local.length > 0 && (
          <optgroup label={SCOPE_LABEL.local}>
            {grouped.local.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.provider})
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {loadError && (
        <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger flex items-start gap-2">
          <span>⚠️</span>
          <span className="flex-1">Failed to load credentials: {loadError}</span>
        </div>
      )}

      {showMissingBanner && (
        <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger flex items-center gap-2">
          <span>⚠️</span>
          <span className="flex-1">
            Credential missing — pick a replacement above.
          </span>
          <button
            className="text-danger hover:text-danger-hover underline cursor-pointer border-none bg-transparent text-[11px]"
            onClick={() => onSelect(null)}
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className="text-[11px] text-accent hover:text-text-main border border-border-subtle rounded-md px-2 py-1 cursor-pointer bg-card hover:bg-card-hover transition-colors"
          onClick={() => setAddOpen((v) => !v)}
        >
          {addOpen ? "× Cancel" : "+ Add new"}
        </button>
        {!loading && (
          <button
            type="button"
            className="text-[11px] text-text-muted hover:text-text-main border border-border-subtle rounded-md px-2 py-1 cursor-pointer bg-card hover:bg-card-hover transition-colors"
            onClick={refresh}
            title="Refresh credential list"
          >
            ⟳
          </button>
        )}
      </div>

      {addOpen && (
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
      )}
    </div>
  );
}

