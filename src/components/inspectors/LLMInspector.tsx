import type { InspectorProps } from "./types";
import DataConsole from "./shared/DataConsole";
import CredentialPicker from "./shared/CredentialPicker";
import ModelPicker from "./shared/ModelPicker";
import {
  PROVIDER_BASE_URL,
  PROVIDER_SCHEMA_TYPES,
  type ProviderType,
} from "@/services/llmProviders";

export default function LLMInspector({
  node,
  onUpdate,
  workspacePath,
}: InspectorProps) {
  const provider = (node.data?.provider || "Ollama") as ProviderType;

  // Resolve current values with sensible defaults and backward-compatibility fallbacks
  const baseURLValue = String(node.data?.baseURL !== undefined ? node.data?.baseURL : (node.data?.ollamaUrl !== undefined ? node.data?.ollamaUrl : (provider === "Ollama" ? "http://localhost:11434" : "")));
  const modelNameValue = String(node.data?.modelName !== undefined ? node.data?.modelName : (node.data?.model !== undefined ? node.data?.model : ""));
  const credentialId = (node.data?.credentialId as string | undefined) ?? null;

  const limitValue = Number(node.data?.chatHistoryLimit || 0);
  const isLimited = limitValue > 0;

  const handleProviderChange = (newProvider: ProviderType) => {
    const updatedData = { ...node.data };
    updatedData.provider = newProvider;
    updatedData.baseURL = PROVIDER_BASE_URL[newProvider];
    updatedData.modelName = "";

    // Strip any lingering inline apiKey from legacy state — credentials live in the vault now.
    delete updatedData.apiKey;

    // Switching to Ollama means no credential is needed; drop the reference so
    // the inspector doesn't carry a stale id. For other transitions the picker
    // detects schema mismatch and renders its "Credential missing" banner.
    if (credentialId && PROVIDER_SCHEMA_TYPES[newProvider].length === 0) {
      delete updatedData.credentialId;
    }

    onUpdate(node.id, updatedData);
  };

  const showBaseURL = provider === "Ollama" || provider === "Other";
  const schemaTypes = PROVIDER_SCHEMA_TYPES[provider];

  return (
    <div className="border-t border-border-subtle pt-4 flex flex-col gap-4">
      <div className="text-[11px] uppercase tracking-widest font-bold text-text-muted mb-1">LLM Configuration</div>

      {/* Provider Selector */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">LLM Provider</label>
        <select
          className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none cursor-pointer"
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

      {/* Dynamic Base URL Field */}
      {showBaseURL && (
        <div className="flex flex-col gap-2 animate-[fadeIn_0.15s_ease-out]">
          <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Base URL</label>
          <input
            className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
            type="text"
            value={baseURLValue}
            placeholder={provider === "Ollama" ? "http://localhost:11434" : "e.g. https://api.yourprovider.com/v1"}
            onChange={(e) =>
              onUpdate(node.id, {
                ...node.data,
                baseURL: e.target.value,
                // Keep ollamaUrl synced in case legacy modules read it
                ollamaUrl: e.target.value,
              })
            }
          />
        </div>
      )}

      {/* Credential Picker (replaces the old API key input) */}
      <CredentialPicker
        schemaTypes={schemaTypes}
        selectedCredentialId={credentialId}
        onSelect={(id) =>
          onUpdate(node.id, {
            ...node.data,
            credentialId: id ?? undefined,
          })
        }
        workspacePath={workspacePath}
      />

      {/* Model picker — scoped dropdown (built-in / global / workspace) with inline add */}
      <ModelPicker
        provider={provider}
        selectedModel={modelNameValue}
        onSelect={(name) =>
          onUpdate(node.id, {
            ...node.data,
            modelName: name,
            // Keep model synced for backwards compatibility
            model: name,
          })
        }
        workspacePath={workspacePath}
      />


      {/* Universal Parameters */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">System Prompt</label>
        <textarea
          className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none resize-y min-h-[80px] font-inherit"
          value={String(node.data?.systemPrompt || "")}
          onChange={(e) =>
            onUpdate(node.id, {
              ...node.data,
              systemPrompt: e.target.value,
            })
          }
          placeholder="You are a helpful AI assistant."
          rows={3}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Temperature: {Number(node.data?.temperature || 0.7).toFixed(2)}
        </label>
        <input
          className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={Number(node.data?.temperature || 0.7)}
          onChange={(e) =>
            onUpdate(node.id, {
              ...node.data,
              temperature: parseFloat(e.target.value),
            })
          }
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Max Tokens</label>
        <input
          className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
          type="number"
          value={Number(node.data?.maxTokens || 2048)}
          onChange={(e) =>
            onUpdate(node.id, {
              ...node.data,
              maxTokens: parseInt(e.target.value, 10),
            })
          }
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Limit Chat History
          </span>
          <button
            onClick={() => {
              onUpdate(node.id, {
                ...node.data,
                chatHistoryLimit: isLimited ? 0 : 10,
              });
            }}
            className={`w-10 h-5.5 rounded-full p-0.5 transition-colors duration-200 outline-none cursor-pointer flex items-center ${
              isLimited ? "bg-[#d4e600]" : "bg-[#2a2a2a]"
            }`}
            style={{ border: isLimited ? "none" : "1px solid #3a3a3a" }}
          >
            <div
              className={`w-4.5 h-4.5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
                isLimited ? "translate-x-4.5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {isLimited && (
          <div className="flex flex-col gap-2 pl-1 animate-[fadeIn_0.15s_ease-out]">
            <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
              History Turn Limit (messages)
            </label>
            <input
              className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
              type="number"
              min="1"
              value={limitValue}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                onUpdate(node.id, {
                  ...node.data,
                  chatHistoryLimit: isNaN(val) || val <= 0 ? 1 : val,
                });
              }}
              placeholder="e.g. 10"
            />
          </div>
        )}
      </div>

      {/* Last Response Visual Console */}
      {!!node.data?.lastResponse && (
        <div className="flex flex-col gap-2 mt-2 border-t border-border-subtle pt-4">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Last Response</label>
            <button
              onClick={() => onUpdate(node.id, { ...node.data, lastResponse: "" })}
              className="text-[10px] text-text-muted hover:text-[#ff6b6b] transition-colors cursor-pointer border-none bg-transparent"
              title="Clear response"
            >
              Clear
            </button>
          </div>
          <DataConsole content={String(node.data.lastResponse)} />
        </div>
      )}
    </div>
  );
}
