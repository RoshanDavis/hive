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

// Backend writes timestamps as Unix seconds in a string (now_iso in utils.rs).
// We format them as relative time for the row UI.
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

interface CredentialManagerProps {
  /** When provided, the workspace section is visible alongside global. When omitted, only global credentials show. */
  workspacePath?: string;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function CredentialManager({
  workspacePath,
  showToast,
}: CredentialManagerProps) {
  const [credentials, setCredentials] = useState<CredentialMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<CredentialScope | null>(null);

  const schemas = useMemo(() => pluginRegistry.getCredentialSchemas(), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await credentialService.list(workspacePath);
      setCredentials(list);
    } catch (err) {
      showToast(`Failed to load credentials: ${err}`, "error");
    } finally {
      setLoading(false);
    }
  }, [workspacePath, showToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const grouped = useMemo(() => {
    const g: Record<CredentialScope, CredentialMeta[]> = {
      global: [],
      local: [],
    };
    for (const c of credentials) g[c.scope].push(c);
    g.global.sort((a, b) => a.name.localeCompare(b.name));
    g.local.sort((a, b) => a.name.localeCompare(b.name));
    return g;
  }, [credentials]);

  const handleDelete = async (cred: CredentialMeta) => {
    const ok = window.confirm(
      `Delete credential "${cred.name}"? Any nodes referencing it will need to be re-linked.`
    );
    if (!ok) return;
    try {
      await credentialService.remove(cred.scope, cred.id, workspacePath);
      showToast(`Deleted "${cred.name}"`, "success");
      refresh();
    } catch (err) {
      showToast(`Failed to delete: ${err}`, "error");
    }
  };

  const handleTransfer = async (cred: CredentialMeta) => {
    const to: CredentialScope = cred.scope === "global" ? "local" : "global";
    if (to === "local" && !workspacePath) {
      showToast("Open a workspace to move a credential to local scope", "error");
      return;
    }
    if (to === "local") {
      const ok = window.confirm(
        `Move "${cred.name}" to this workspace only? It will become unavailable in other workspaces.`
      );
      if (!ok) return;
    }
    try {
      await credentialService.transfer(cred.id, cred.scope, to, workspacePath);
      showToast(`Moved "${cred.name}" to ${to}`, "success");
      refresh();
    } catch (err) {
      showToast(`Failed to move: ${err}`, "error");
    }
  };

  const renderRow = (cred: CredentialMeta) => {
    const schema = schemas.find((s) => s.type === cred.schemaType);
    const isEditing = editingId === cred.id;
    return (
      <div
        key={cred.id}
        className="bg-secondary/30 border border-border-subtle hover:border-accent-dim/20 rounded-lg px-3 py-2.5 flex flex-col gap-2 transition-colors"
      >
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
              onClick={() => setEditingId(isEditing ? null : cred.id)}
              className="text-[10px] text-text-muted hover:text-text-main bg-transparent border border-border-subtle rounded-md px-2 py-1 cursor-pointer transition-colors"
              title="Edit"
            >
              {isEditing ? "× Close" : "✏️ Edit"}
            </button>
            {workspacePath && (
              <button
                type="button"
                onClick={() => handleTransfer(cred)}
                className="text-[10px] text-text-muted hover:text-text-main bg-transparent border border-border-subtle rounded-md px-2 py-1 cursor-pointer transition-colors"
                title={cred.scope === "global" ? "Move to workspace" : "Move to global"}
              >
                {cred.scope === "global" ? "→📁" : "→🌐"}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleDelete(cred)}
              className="text-[10px] text-text-muted hover:text-red-400 bg-transparent border border-border-subtle rounded-md px-2 py-1 cursor-pointer transition-colors"
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
            onDone={() => {
              setEditingId(null);
              refresh();
            }}
            showToast={showToast}
          />
        )}
      </div>
    );
  };

  const renderSection = (scope: CredentialScope, label: string) => {
    const items = grouped[scope];
    const canAddHere = scope === "global" || !!workspacePath;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
            {label} ({items.length})
          </span>
          {canAddHere && (
            <button
              type="button"
              onClick={() => setAddMode(addMode === scope ? null : scope)}
              className="text-[10px] text-accent hover:text-text-main bg-transparent border border-border-subtle rounded-md px-2 py-0.5 cursor-pointer transition-colors"
            >
              {addMode === scope ? "× Cancel" : "+ Add"}
            </button>
          )}
        </div>
        {addMode === scope && (
          <AddCredentialForm
            scope={scope}
            workspacePath={workspacePath}
            schemas={schemas}
            onDone={() => {
              setAddMode(null);
              refresh();
            }}
            showToast={showToast}
          />
        )}
        {items.length === 0 ? (
          <div className="text-[10.5px] text-text-muted italic px-1">
            No credentials saved.
          </div>
        ) : (
          <div className="flex flex-col gap-2">{items.map(renderRow)}</div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5 border-b border-border-subtle pb-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 text-sm font-bold text-text-main hover:text-accent transition-colors bg-transparent border-none cursor-pointer p-0 select-none outline-none"
        >
          <span>{open ? "▼" : "▶"} Credentials</span>
        </button>
        <p className="text-[10px] text-text-muted mt-1">
          API keys and access tokens used by nodes. Encrypted at rest with a
          per-machine master key stored in the OS credential manager.
        </p>
      </div>

      {open && (
        <div className="flex flex-col gap-4 animate-[fadeIn_0.15s_ease-out]">
          {loading && (
            <div className="text-[10.5px] text-text-muted italic">Loading…</div>
          )}
          {renderSection("global", "🌐 Global")}
          {workspacePath && renderSection("local", "📁 Workspace")}
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
  showToast: (msg: string, type: "success" | "error" | "info") => void;
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

interface EditFormProps {
  cred: CredentialMeta;
  schema: CredentialSchema;
  workspacePath?: string;
  onDone: () => void;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
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
  const [saving, setSaving] = useState(false);

  // Fetch current values immediately when the form opens. Fields render
  // masked by default; the per-field eye toggle is how the user reveals them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await credentialService.resolve(
          cred.id,
          cred.scope,
          workspacePath
        );
        if (cancelled) return;
        setValues(current);
        setInitialSnapshot(JSON.stringify(current));
      } catch (err) {
        if (cancelled) return;
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
    setSaving(true);
    try {
      const nameChanged = name !== cred.name;
      const valuesChanged =
        initialSnapshot !== null && JSON.stringify(values) !== initialSnapshot;
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
