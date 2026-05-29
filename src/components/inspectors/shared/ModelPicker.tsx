import { useCallback, useEffect, useMemo, useState } from "react";
import { BUILT_IN_MODELS, normalizeProvider, type ProviderKey } from "@/services/builtInModels";
import { nodeDefaultsService, type DefaultsScope } from "@/services/nodeDefaultsService";
import type { ModelEntry } from "@/services/api";
import { formLabelClass, formInputClass } from "@/components/shared/FormField";

interface ModelPickerProps {
  /** Provider string from the inspector (e.g. "Ollama", "OpenAI"). Picker normalizes it. */
  provider: string;
  selectedModel: string;
  onSelect: (name: string) => void;
  /** Null on the landing page; set inside a workspace. Determines whether 📁 Workspace group is shown. */
  workspacePath: string | null;
}

export default function ModelPicker({
  provider,
  selectedModel,
  onSelect,
  workspacePath,
}: ModelPickerProps) {
  const providerKey: ProviderKey = useMemo(() => normalizeProvider(provider), [provider]);

  const [globalUserModels, setGlobalUserModels] = useState<ModelEntry[]>([]);
  const [workspaceUserModels, setWorkspaceUserModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      nodeDefaultsService.invalidate(workspacePath ?? undefined);
      const g = await nodeDefaultsService.listModels("global", providerKey, null);
      setGlobalUserModels(g);
      if (workspacePath) {
        const w = await nodeDefaultsService.listModels("workspace", providerKey, workspacePath);
        setWorkspaceUserModels(w);
      } else {
        setWorkspaceUserModels([]);
      }
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }
  }, [providerKey, workspacePath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const builtIn = BUILT_IN_MODELS[providerKey];

  const allKnownNames = useMemo(() => {
    const names = new Set<string>();
    builtIn.forEach((n) => names.add(n));
    globalUserModels.forEach((m) => names.add(m.name));
    workspaceUserModels.forEach((m) => names.add(m.name));
    return names;
  }, [builtIn, globalUserModels, workspaceUserModels]);

  const showMissingBanner =
    !loading && selectedModel.trim() !== "" && !allKnownNames.has(selectedModel);

  return (
    <div className="flex flex-col gap-2 animate-[fadeIn_0.15s_ease-out]">
      <label className={formLabelClass}>
        Model
      </label>

      <select
        className={`${formInputClass} cursor-pointer`}
        value={allKnownNames.has(selectedModel) ? selectedModel : ""}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="">— Select a model —</option>
        {builtIn.length > 0 && (
          <optgroup label="⭐ Built-in">
            {builtIn.map((name) => (
              <option key={`b-${name}`} value={name}>
                {name}
              </option>
            ))}
          </optgroup>
        )}
        {globalUserModels.length > 0 && (
          <optgroup label="🌐 Global">
            {globalUserModels.map((m) => (
              <option key={`g-${m.name}`} value={m.name}>
                {m.name}
              </option>
            ))}
          </optgroup>
        )}
        {workspaceUserModels.length > 0 && (
          <optgroup label="📁 Workspace">
            {workspaceUserModels.map((m) => (
              <option key={`w-${m.name}`} value={m.name}>
                {m.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {loadError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2 text-[11px] text-red-300 flex items-start gap-2">
          <span>⚠️</span>
          <span className="flex-1">Failed to load models: {loadError}</span>
        </div>
      )}

      {showMissingBanner && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2 text-[11px] text-red-300 flex items-center gap-2">
          <span>⚠️</span>
          <span className="flex-1">
            Model "<span className="font-mono">{selectedModel}</span>" not in any list — pick a
            replacement above or add it below.
          </span>
          <button
            className="text-red-200 hover:text-white underline cursor-pointer border-none bg-transparent text-[11px]"
            onClick={() => onSelect("")}
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
            title="Refresh model list"
          >
            ⟳
          </button>
        )}
      </div>

      {addOpen && (
        <AddModelMiniForm
          providerKey={providerKey}
          workspacePath={workspacePath}
          onCancel={() => setAddOpen(false)}
          onAdded={(name) => {
            setAddOpen(false);
            onSelect(name);
            refresh();
          }}
        />
      )}
    </div>
  );
}

interface AddFormProps {
  providerKey: ProviderKey;
  workspacePath: string | null;
  onCancel: () => void;
  onAdded: (name: string) => void;
}

function AddModelMiniForm({ providerKey, workspacePath, onCancel, onAdded }: AddFormProps) {
  const [name, setName] = useState("");
  // Inside a workspace, default to local for privacy parity with credentials.
  const [scope, setScope] = useState<DefaultsScope>(workspacePath ? "workspace" : "global");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Model name is required");
      return;
    }
    if (scope === "workspace" && !workspacePath) {
      setError("Workspace scope requires an open workspace");
      return;
    }
    setSaving(true);
    try {
      await nodeDefaultsService.addModel(scope, providerKey, trimmed, workspacePath);
      onAdded(trimmed);
    } catch (err) {
      setError(`Failed to save model: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-border-subtle rounded-md p-3 bg-card/60 flex flex-col gap-2 animate-[fadeIn_0.15s_ease-out]">
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Model name
        </label>
        <input
          className="w-full bg-input border border-border-subtle rounded-md px-2 py-1.5 text-xs text-text-main outline-none"
          type="text"
          value={name}
          placeholder={`e.g. ${providerKey === "anthropic" ? "claude-3-5-haiku-latest" : providerKey === "openai" ? "gpt-4o" : "model-id"}`}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Save to
        </label>
        <select
          className="w-full bg-input border border-border-subtle rounded-md px-2 py-1.5 text-xs text-text-main outline-none cursor-pointer"
          value={scope}
          onChange={(e) => setScope(e.target.value as DefaultsScope)}
        >
          {workspacePath && (
            <option value="workspace">📁 This workspace only</option>
          )}
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
