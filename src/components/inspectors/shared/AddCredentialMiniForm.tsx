import { useEffect, useMemo, useState } from "react";
import { credentialService } from "@/services/credentialService";
import RevealableField from "@/components/shared/RevealableField";
import type {
  CredentialMeta,
  CredentialScope,
  CredentialSchema,
  CredentialValues,
} from "@/types/credentialTypes";

export interface AddCredentialMiniFormProps {
  /** Credential schemas the user may create here, in display order. */
  acceptedSchemas: CredentialSchema[];
  /**
   * The workspace this form lives in. Determines whether local scope is offered /
   * the default scope when adding. Null in workspace-less contexts (global), where
   * only global credentials apply.
   */
  workspacePath: string | null;
  onCancel: () => void;
  onCreated: (meta: CredentialMeta) => void;
}

/**
 * Inline "add a new credential" mini-form: pick a schema type, name it, fill the
 * (revealable) secret fields, choose a scope, and persist to the vault. Shared by the
 * single-select {@link CredentialPicker} and the multi-grant credential grant list.
 */
export default function AddCredentialMiniForm({
  acceptedSchemas,
  workspacePath,
  onCancel,
  onCreated,
}: AddCredentialMiniFormProps) {
  const [schemaType, setSchemaType] = useState(acceptedSchemas[0]?.type ?? "");
  const [name, setName] = useState("");
  // Workspace context defaults new credentials to local for privacy. Without a
  // workspace (global node-defaults context), only global credentials are valid.
  const [scope, setScope] = useState<CredentialScope>(workspacePath ? "local" : "global");
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
        workspacePath ?? undefined
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
          {workspacePath && <option value="local">📁 This workspace only</option>}
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
