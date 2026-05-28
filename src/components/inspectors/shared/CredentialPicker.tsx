import { useCallback, useEffect, useMemo, useState } from "react";
import { credentialService } from "@/services/credentialService";
import { pluginRegistry } from "@/engine/pluginRegistry";
import RevealableField from "@/components/shared/RevealableField";
import type {
  CredentialMeta,
  CredentialScope,
  CredentialSchema,
  CredentialValues,
} from "@/types/credentialTypes";

interface CredentialPickerProps {
  /** Which credential schema types are acceptable. Empty array = no picker rendered. */
  schemaTypes: string[];
  /** Currently selected credential id, or null. */
  selectedCredentialId: string | null;
  /** Called when the user picks or clears a credential. */
  onSelect: (id: string | null) => void;
  /** The workspace this picker lives in. Determines whether local credentials are visible / default scope when adding. */
  workspacePath: string;
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
      const list = await credentialService.list(workspacePath);
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
      <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Credential
      </label>

      <select
        className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none cursor-pointer"
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
        <div className="bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2 text-[11px] text-red-300 flex items-start gap-2">
          <span>⚠️</span>
          <span className="flex-1">Failed to load credentials: {loadError}</span>
        </div>
      )}

      {showMissingBanner && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2 text-[11px] text-red-300 flex items-center gap-2">
          <span>⚠️</span>
          <span className="flex-1">
            Credential missing — pick a replacement above.
          </span>
          <button
            className="text-red-200 hover:text-white underline cursor-pointer border-none bg-transparent text-[11px]"
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

interface AddFormProps {
  acceptedSchemas: CredentialSchema[];
  workspacePath: string;
  onCancel: () => void;
  onCreated: (meta: CredentialMeta) => void;
}

function AddCredentialMiniForm({
  acceptedSchemas,
  workspacePath,
  onCancel,
  onCreated,
}: AddFormProps) {
  const [schemaType, setSchemaType] = useState(acceptedSchemas[0]?.type ?? "");
  const [name, setName] = useState("");
  // Workspace context defaults new credentials to local for privacy.
  const [scope, setScope] = useState<CredentialScope>("local");
  const [values, setValues] = useState<CredentialValues>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const schema = useMemo(
    () => acceptedSchemas.find((s) => s.type === schemaType),
    [acceptedSchemas, schemaType]
  );

  // Reset values when schema changes so we don't carry over fields that no
  // longer exist on the new schema.
  useEffect(() => {
    setValues({});
  }, [schemaType]);

  const handleSave = async () => {
    if (!schema) return;
    setError(null);
    const missing = schema.fields
      .filter((f) => f.required && !values[f.key]?.trim())
      .map((f) => f.label);
    if (missing.length > 0) {
      setError(`Missing required fields: ${missing.join(", ")}`);
      return;
    }
    if (!name.trim()) {
      setError("Credential name is required");
      return;
    }
    setSaving(true);
    try {
      const meta = await credentialService.add(
        scope,
        name.trim(),
        schema.type,
        schema.provider,
        values,
        workspacePath
      );
      onCreated(meta);
    } catch (err) {
      setError(`Failed to save credential: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  if (acceptedSchemas.length === 0) return null;

  return (
    <div className="border border-border-subtle rounded-md p-3 bg-card/60 flex flex-col gap-2 animate-[fadeIn_0.15s_ease-out]">
      {acceptedSchemas.length > 1 && (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Type
          </label>
          <select
            className="w-full bg-input border border-border-subtle rounded-md px-2 py-1.5 text-xs text-text-main outline-none cursor-pointer"
            value={schemaType}
            onChange={(e) => setSchemaType(e.target.value)}
          >
            {acceptedSchemas.map((s) => (
              <option key={s.type} value={s.type}>
                {s.icon ?? ""} {s.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Name
        </label>
        <input
          className="w-full bg-input border border-border-subtle rounded-md px-2 py-1.5 text-xs text-text-main outline-none"
          type="text"
          value={name}
          placeholder={`My ${schema?.provider ?? ""} key`}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {schema?.fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            {field.label}
            {!field.required && <span className="text-text-muted/60"> (optional)</span>}
          </label>
          <RevealableField
            type={field.type}
            value={values[field.key] ?? ""}
            placeholder={field.placeholder}
            onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
          />
        </div>
      ))}

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Save to
        </label>
        <select
          className="w-full bg-input border border-border-subtle rounded-md px-2 py-1.5 text-xs text-text-main outline-none cursor-pointer"
          value={scope}
          onChange={(e) => setScope(e.target.value as CredentialScope)}
        >
          <option value="local">📁 This workspace only</option>
          <option value="global">🌐 All workspaces (global)</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md px-2 py-1.5 text-[10.5px] text-red-300">
          {error}
        </div>
      )}

      <div className="flex gap-2 mt-1">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="flex-1 bg-accent/30 hover:bg-accent/45 border border-accent/50 hover:border-accent text-text-main rounded-md px-2 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="bg-card hover:bg-card-hover border border-border-subtle rounded-md px-2 py-1.5 text-xs text-text-muted hover:text-text-main cursor-pointer transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
