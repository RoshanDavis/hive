import { useEffect, useState } from "react";
import { credentialService } from "@/services/credentialService";
import RevealableField from "@/components/shared/RevealableField";
import type {
  CredentialMeta,
  CredentialScope,
  CredentialSchema,
  CredentialValues,
} from "@/types/credentialTypes";

type ShowToast = (msg: string, type: "success" | "error" | "info") => void;

// Backend writes timestamps as Unix seconds in a string (now_iso in utils.rs).
function formatRelative(unixSeconds: string): string {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return unixSeconds;
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000 - n));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(n * 1000).toLocaleDateString();
}

interface CredentialRowProps {
  cred: CredentialMeta;
  schema: CredentialSchema | undefined;
  workspacePath?: string;
  /** When true, the inline edit form is shown beneath the row. */
  isEditing: boolean;
  onToggleEdit: () => void;
  /** Transfer button is rendered only when a workspace is open. */
  showTransfer: boolean;
  onTransfer: () => void;
  onDelete: () => void;
  onEditDone: () => void;
  showToast: ShowToast;
}

/** One credential row in a scope group + its inline edit form. */
export default function CredentialRow({
  cred,
  schema,
  workspacePath,
  isEditing,
  onToggleEdit,
  showTransfer,
  onTransfer,
  onDelete,
  onEditDone,
  showToast,
}: CredentialRowProps) {
  return (
    <div className="bg-secondary/30 border border-border-subtle hover:border-border-card rounded-lg px-3 py-2.5 flex flex-col gap-2 transition-colors">
      <div className="flex items-center gap-3">
        <span className="text-base">{schema?.icon ?? "🔑"}</span>
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-text-main truncate">
              {cred.name}
            </span>
            <span className="px-1.5 py-0.5 text-[9px] font-bold bg-accent-glow border border-accent/25 text-accent rounded-full whitespace-nowrap">
              {cred.provider}
            </span>
          </div>
          <span
            className="text-[10px] text-text-muted"
            title={`Updated ${cred.updatedAt}`}
          >
            {schema?.label ?? cred.schemaType} · updated {formatRelative(cred.updatedAt)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleEdit}
            disabled={!schema}
            className="text-[10px] text-text-muted hover:text-text-main bg-transparent border border-border-subtle rounded-md px-2 py-1 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-text-muted"
            title={schema ? "Edit" : "Schema unavailable"}
          >
            {isEditing ? "× Close" : "✏️ Edit"}
          </button>
          {showTransfer && (
            <button
              type="button"
              onClick={onTransfer}
              className="text-[10px] text-text-muted hover:text-text-main bg-transparent border border-border-subtle rounded-md px-2 py-1 cursor-pointer transition-colors"
              title={cred.scope === "global" ? "Move to workspace" : "Move to global"}
            >
              {cred.scope === "global" ? "→📁" : "→🌐"}
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="text-[10px] text-text-muted hover:text-danger bg-transparent border border-border-subtle rounded-md px-2 py-1 cursor-pointer transition-colors"
            title="Delete"
          >
            🗑️
          </button>
        </div>
      </div>
      {isEditing && schema && (
        <EditCredentialForm
          cred={cred}
          schema={schema}
          workspacePath={workspacePath}
          onDone={onEditDone}
          showToast={showToast}
        />
      )}
    </div>
  );
}

interface EditFormProps {
  cred: CredentialMeta;
  schema: CredentialSchema;
  workspacePath?: string;
  onDone: () => void;
  showToast: ShowToast;
}

function EditCredentialForm({
  cred,
  schema,
  workspacePath,
  onDone,
  showToast,
}: EditFormProps) {
  const [name, setName] = useState(cred.name);
  const [values, setValues] = useState<CredentialValues>({});
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch current values immediately when the form opens. Fields render
  // masked by default; the per-field eye toggle is how the user reveals them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await credentialService.resolve(
          cred.id,
          cred.scope as CredentialScope,
          workspacePath
        );
        if (cancelled) return;
        setValues(current);
        setInitialSnapshot(JSON.stringify(current));
        setLoadError(false);
      } catch (err) {
        if (cancelled) return;
        setLoadError(true);
        showToast(`Failed to load credential: ${err}`, "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cred.id, cred.scope, workspacePath, showToast]);

  const handleSave = async () => {
    // Block saves when the initial load failed: we have no baseline to diff
    // against, so any "no-op" detection would silently drop user edits.
    if (loadError || initialSnapshot === null) {
      showToast("Cannot save — credential failed to load.", "error");
      return;
    }
    setSaving(true);
    try {
      const nameChanged = name !== cred.name;
      const valuesChanged = JSON.stringify(values) !== initialSnapshot;
      // Skip the no-op case: nothing to save.
      if (!nameChanged && !valuesChanged) {
        onDone();
        return;
      }
      await credentialService.update(
        cred.scope,
        cred.id,
        nameChanged ? name : null,
        valuesChanged ? values : null,
        workspacePath
      );
      showToast(`Updated "${name}"`, "success");
      onDone();
    } catch (err) {
      showToast(`Failed to update: ${err}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-input/40 border border-border-subtle rounded-lg p-3 flex flex-col gap-2 animate-[fadeIn_0.15s_ease-out]">
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-input border border-border-subtle rounded-md px-2 py-1.5 text-xs text-text-main outline-none"
        />
      </div>

      {schema.fields.map((field) => (
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
            placeholder={loading ? "Loading…" : field.placeholder}
            disabled={loading}
            onChange={(v) =>
              setValues((prev) => ({ ...prev, [field.key]: v }))
            }
          />
        </div>
      ))}

      <div className="flex gap-2 mt-1">
        <button
          type="button"
          disabled={saving || loading}
          onClick={handleSave}
          className="flex-1 bg-accent/30 hover:bg-accent/45 border border-accent/50 text-text-main rounded-md px-2 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving…" : loading ? "Loading…" : "Save changes"}
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
