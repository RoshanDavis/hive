import { useEffect, useMemo, useState } from "react";
import { credentialService } from "@/services/credentialService";
import RevealableField from "@/components/shared/RevealableField";
import CredentialRow from "@/components/settings/CredentialRow";
import type {
  CredentialMeta,
  CredentialScope,
  CredentialSchema,
  CredentialValues,
} from "@/types/credentialTypes";

type ShowToast = (msg: string, type: "success" | "error" | "info") => void;

interface CredentialScopeGroupProps {
  scope: CredentialScope;
  label: string;
  items: CredentialMeta[];
  schemas: CredentialSchema[];
  workspacePath?: string;
  /** Whether the inline add form is open for this scope. */
  isAdding: boolean;
  onToggleAdd: () => void;
  onAddDone: () => void;
  /** Editing state from the parent (single-row-at-a-time across both groups). */
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onEditDone: () => void;
  onTransfer: (cred: CredentialMeta) => void;
  onDelete: (cred: CredentialMeta) => void;
  showToast: ShowToast;
}

/**
 * One scope section in the credential manager: header with item count and add
 * toggle, optionally the inline add form, then the list of credential rows.
 */
export default function CredentialScopeGroup({
  scope,
  label,
  items,
  schemas,
  workspacePath,
  isAdding,
  onToggleAdd,
  onAddDone,
  editingId,
  setEditingId,
  onEditDone,
  onTransfer,
  onDelete,
  showToast,
}: CredentialScopeGroupProps) {
  const canAddHere = scope === "global" || !!workspacePath;
  const showTransfer = !!workspacePath;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
          {label} ({items.length})
        </span>
        {canAddHere && (
          <button
            type="button"
            onClick={onToggleAdd}
            className="text-[10px] text-accent hover:text-text-main bg-transparent border border-border-subtle rounded-md px-2 py-0.5 cursor-pointer transition-colors"
          >
            {isAdding ? "× Cancel" : "+ Add"}
          </button>
        )}
      </div>
      {isAdding && (
        <AddCredentialForm
          scope={scope}
          workspacePath={workspacePath}
          schemas={schemas}
          onDone={onAddDone}
          showToast={showToast}
        />
      )}
      {items.length === 0 ? (
        <div className="text-[10.5px] text-text-muted italic px-1">
          No credentials saved.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((cred) => {
            const schema = schemas.find((s) => s.type === cred.schemaType);
            const isEditing = editingId === cred.id;
            return (
              <CredentialRow
                key={cred.id}
                cred={cred}
                schema={schema}
                workspacePath={workspacePath}
                isEditing={isEditing}
                onToggleEdit={() => setEditingId(isEditing ? null : cred.id)}
                showTransfer={showTransfer}
                onTransfer={() => onTransfer(cred)}
                onDelete={() => onDelete(cred)}
                onEditDone={onEditDone}
                showToast={showToast}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface AddFormProps {
  scope: CredentialScope;
  workspacePath?: string;
  schemas: CredentialSchema[];
  onDone: () => void;
  showToast: ShowToast;
}

function AddCredentialForm({
  scope,
  workspacePath,
  schemas,
  onDone,
  showToast,
}: AddFormProps) {
  const [schemaType, setSchemaType] = useState(schemas[0]?.type ?? "");
  const [name, setName] = useState("");
  const [values, setValues] = useState<CredentialValues>({});
  const [saving, setSaving] = useState(false);

  const schema = useMemo(
    () => schemas.find((s) => s.type === schemaType),
    [schemas, schemaType]
  );

  useEffect(() => {
    setValues({});
  }, [schemaType]);

  const handleSave = async () => {
    if (!schema) return;
    if (!name.trim()) {
      showToast("Name is required", "error");
      return;
    }
    const missing = schema.fields
      .filter((f) => f.required && !values[f.key]?.trim())
      .map((f) => f.label);
    if (missing.length > 0) {
      showToast(`Missing required fields: ${missing.join(", ")}`, "error");
      return;
    }
    setSaving(true);
    try {
      await credentialService.add(
        scope,
        name.trim(),
        schema.type,
        schema.provider,
        values,
        workspacePath
      );
      showToast(`Saved "${name.trim()}"`, "success");
      onDone();
    } catch (err) {
      showToast(`Failed to save: ${err}`, "error");
    } finally {
      setSaving(false);
    }
  };

  if (schemas.length === 0) {
    return (
      <div className="text-[10.5px] text-text-muted italic px-1">
        No credential schemas registered. (Install a plugin that declares one.)
      </div>
    );
  }

  return (
    <div className="bg-input/40 border border-border-subtle rounded-lg p-3 flex flex-col gap-2 animate-[fadeIn_0.15s_ease-out]">
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Type
        </label>
        <select
          className="w-full bg-input border border-border-subtle rounded-md px-2 py-1.5 text-xs text-text-main outline-none cursor-pointer"
          value={schemaType}
          onChange={(e) => setSchemaType(e.target.value)}
        >
          {schemas.map((s) => (
            <option key={s.type} value={s.type}>
              {s.icon ?? ""} {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Name
        </label>
        <input
          type="text"
          value={name}
          placeholder={`My ${schema?.provider ?? ""} key`}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-input border border-border-subtle rounded-md px-2 py-1.5 text-xs text-text-main outline-none"
        />
      </div>

      {schema?.fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            {field.label}
            {!field.required && (
              <span className="text-text-muted/60"> (optional)</span>
            )}
          </label>
          <RevealableField
            type={field.type}
            value={values[field.key] ?? ""}
            placeholder={field.placeholder}
            onChange={(v) =>
              setValues((prev) => ({ ...prev, [field.key]: v }))
            }
          />
        </div>
      ))}

      <div className="flex gap-2 mt-1">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="flex-1 bg-accent/30 hover:bg-accent/45 border border-accent/50 text-text-main rounded-md px-2 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving…" : `Save to ${scope === "global" ? "🌐 Global" : "📁 Workspace"}`}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onDone}
          className="bg-card hover:bg-card-hover border border-border-subtle rounded-md px-2 py-1.5 text-xs text-text-muted hover:text-text-main cursor-pointer transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
