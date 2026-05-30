import ModelPicker from "@/components/inspectors/shared/ModelPicker";
import CredentialPicker from "@/components/inspectors/shared/CredentialPicker";
import type { DefaultsEditorProps } from "@/engine/plugin";
import { formInputClass, formLabelClass, formRangeClass } from "@/components/shared/FormField";
import {
  PROVIDER_BASE_URL,
  PROVIDER_SCHEMA_TYPES,
  type ProviderType,
} from "@/services/llmProviders";

/**
 * Lightweight defaults editor for LLM nodes. Excludes the run/last-response UI.
 * The credential field stores only a credentialId (the vault model is preserved):
 * at workspace scope it offers global + local credentials; at global scope only
 * global credentials, since a local id wouldn't resolve in other workspaces.
 */
export default function LLMDefaultsEditor({
  values,
  onUpdate,
  workspacePath,
  scope,
}: DefaultsEditorProps) {
  const provider = (values.provider as ProviderType | undefined) ?? "Ollama";
  const modelName = String(values.modelName ?? "");
  const baseURL = String(values.baseURL ?? PROVIDER_BASE_URL[provider]);
  const systemPrompt = String(values.systemPrompt ?? "");
  const temperature = Number(values.temperature ?? 0.7);
  const maxTokens = Number(values.maxTokens ?? 2048);
  const credentialId = (values.credentialId as string | undefined) ?? null;

  const showBaseURL = provider === "Ollama" || provider === "Other";
  const schemaTypes = PROVIDER_SCHEMA_TYPES[provider];

  // Defaults must never store plaintext secrets — only a credentialId. Strip
  // any legacy plaintext fields that might survive from older persisted data
  // so a round-trip through this editor cleans them up.
  const commit = (next: Record<string, unknown>) => {
    const { apiKey: _apiKey, secret: _secret, password: _password, ...sanitized } = next;
    onUpdate(sanitized);
  };

  const handleProviderChange = (next: ProviderType) => {
    const updated: Record<string, unknown> = {
      ...values,
      provider: next,
      baseURL: PROVIDER_BASE_URL[next],
      modelName: "",
    };
    // Drop a stale credential when the new provider needs none (Ollama).
    if (PROVIDER_SCHEMA_TYPES[next].length === 0) delete updated.credentialId;
    commit(updated);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className={formLabelClass}>
          LLM Provider
        </label>
        <select
          className={`${formInputClass} cursor-pointer`}
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value as ProviderType)}
        >
          <option value="Ollama">Ollama (Local)</option>
          <option value="OpenAI">OpenAI</option>
          <option value="Anthropic">Anthropic</option>
          <option value="Google">Google (Gemini)</option>
          <option value="Other">Other (OpenAI-Compatible)</option>
        </select>
      </div>

      {showBaseURL && (
        <div className="flex flex-col gap-2 animate-[fadeIn_0.15s_ease-out]">
          <label className={formLabelClass}>
            Base URL
          </label>
          <input
            className={formInputClass}
            type="text"
            value={baseURL}
            onChange={(e) =>
              commit({ ...values, baseURL: e.target.value })
            }
          />
        </div>
      )}

      {schemaTypes.length > 0 && (
        <div className="flex flex-col gap-2">
          <CredentialPicker
            schemaTypes={schemaTypes}
            selectedCredentialId={credentialId}
            onSelect={(id) => commit({ ...values, credentialId: id ?? undefined })}
            workspacePath={workspacePath}
          />
          {scope === "global" && (
            <p className="text-[10px] text-text-muted leading-relaxed">
              Only global credentials can be used as a global default — a workspace credential
              wouldn't resolve in other workspaces.
            </p>
          )}
        </div>
      )}

      <ModelPicker
        provider={provider}
        selectedModel={modelName}
        onSelect={(name) =>
          commit({ ...values, modelName: name })
        }
        workspacePath={workspacePath}
      />

      <div className="flex flex-col gap-2">
        <label className={formLabelClass}>
          System Prompt
        </label>
        <textarea
          className={`${formInputClass} resize-y min-h-20`}
          value={systemPrompt}
          rows={3}
          onChange={(e) => commit({ ...values, systemPrompt: e.target.value })}
          placeholder="You are a helpful AI assistant."
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className={formLabelClass}>
          Temperature: {temperature.toFixed(2)}
        </label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={temperature}
          onChange={(e) => commit({ ...values, temperature: parseFloat(e.target.value) })}
          className={formRangeClass}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className={formLabelClass}>
          Max Tokens
        </label>
        <input
          type="number"
          value={maxTokens}
          onChange={(e) => commit({ ...values, maxTokens: parseInt(e.target.value, 10) || 0 })}
          className={formInputClass}
        />
      </div>
    </div>
  );
}
