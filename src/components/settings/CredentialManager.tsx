import { useCallback, useEffect, useMemo, useState } from "react";
import { credentialService } from "@/services/credentialService";
import { pluginRegistry } from "@/engine/pluginRegistry";
import CredentialScopeGroup from "@/components/settings/CredentialScopeGroup";
import type { CredentialMeta, CredentialScope } from "@/types/credentialTypes";

interface CredentialManagerProps {
  /** When provided, the workspace section is visible alongside global. When omitted, only global credentials show. */
  workspacePath?: string;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
}

/**
 * Orchestrator for the Credentials section in Settings.
 *
 * Owns the full credential list + load/refresh + delete/transfer handlers, and
 * the singleton edit/add state (only one row may be in edit mode, one scope's
 * add form may be open at a time). Rendering is delegated to
 * `CredentialScopeGroup`, which in turn renders `CredentialRow` for each item.
 */
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

  const onEditDone = () => {
    setEditingId(null);
    refresh();
  };

  const onAddDone = () => {
    setAddMode(null);
    refresh();
  };

  const renderGroup = (scope: CredentialScope, label: string) => (
    <CredentialScopeGroup
      scope={scope}
      label={label}
      items={grouped[scope]}
      schemas={schemas}
      workspacePath={workspacePath}
      isAdding={addMode === scope}
      onToggleAdd={() => setAddMode(addMode === scope ? null : scope)}
      onAddDone={onAddDone}
      editingId={editingId}
      setEditingId={setEditingId}
      onEditDone={onEditDone}
      onTransfer={handleTransfer}
      onDelete={handleDelete}
      showToast={showToast}
    />
  );

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
          {renderGroup("global", "🌐 Global")}
          {workspacePath && renderGroup("local", "📁 Workspace")}
        </div>
      )}
    </div>
  );
}
