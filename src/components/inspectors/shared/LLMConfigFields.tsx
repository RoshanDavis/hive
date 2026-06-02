import CredentialPicker from "./CredentialPicker";
import ModelPicker from "./ModelPicker";
import CollapsibleSection from "../CollapsibleSection";
import { formLabelClass, formInputClass, formRangeClass } from "@/components/shared/FormField";
import {
  PROVIDER_BASE_URL,
  PROVIDER_SCHEMA_TYPES,
  type ProviderType,
} from "@/services/llmProviders";

interface LLMConfigFieldsProps {
  /** The LLM config blob — `node.data` for an LLM node, `node.data.llm` for an
   * Agent's LLM slot. */
  values: Record<string, unknown>;
  /** Receives the FULL updated blob on every change (caller persists it). */
  onChange: (next: Record<string, unknown>) => void;
  workspacePath: string;
}

/**
 * Provider / credential / model / parameter / chat-history fields, shared by
 * LLMInspector and AgentInspector's LLM slot. Output and node-level actions are
 * intentionally left to the host inspector.
 */
export default function LLMConfigFields({ values, onChange, workspacePath }: LLMConfigFieldsProps) {
  const provider = (values.provider || "Ollama") as ProviderType;
  const baseURLValue = String(values.baseURL ?? (provider === "Ollama" ? "http://localhost:11434" : ""));
  const modelNameValue = String(values.modelName ?? "");
  const credentialId = (values.credentialId as string | undefined) ?? null;

  const limitValue = Number(values.chatHistoryLimit || 0);
  const isLimited = limitValue > 0;

  const handleProviderChange = (newProvider: ProviderType) => {
    const next = { ...values };
    next.provider = newProvider;
    next.baseURL = PROVIDER_BASE_URL[newProvider];
    next.modelName = "";

    // A credential belongs to the provider it was created for. On any provider
    // change, drop the stale reference so execution can't send the wrong secret
    // to the new provider; the user re-selects/creates one via the picker.
    if (credentialId && newProvider !== provider) {
      delete next.credentialId;
    }

    onChange(next);
  };

  const showBaseURL = provider === "Ollama" || provider === "Other";
  const schemaTypes = PROVIDER_SCHEMA_TYPES[provider];

  return (
    <>
      <CollapsibleSection title="Provider & Credentials" icon="🔌" defaultOpen={true}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className={formLabelClass}>LLM Provider</label>
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
              <label className={formLabelClass}>Base URL</label>
              <input
                className={formInputClass}
                type="text"
                value={baseURLValue}
                placeholder={provider === "Ollama" ? "http://localhost:11434" : "e.g. https://api.yourprovider.com/v1"}
                onChange={(e) => onChange({ ...values, baseURL: e.target.value })}
              />
            </div>
          )}

          <CredentialPicker
            schemaTypes={schemaTypes}
            selectedCredentialId={credentialId}
            onSelect={(id) => onChange({ ...values, credentialId: id ?? undefined })}
            workspacePath={workspacePath}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Model" icon="🧠" defaultOpen={true}>
        <ModelPicker
          provider={provider}
          selectedModel={modelNameValue}
          onSelect={(name) => onChange({ ...values, modelName: name })}
          workspacePath={workspacePath}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Parameters" icon="⚙️" defaultOpen={true}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className={formLabelClass}>System Prompt</label>
            <textarea
              className={`${formInputClass} resize-y min-h-20 font-inherit`}
              value={String(values.systemPrompt || "")}
              onChange={(e) => onChange({ ...values, systemPrompt: e.target.value })}
              placeholder="You are a helpful AI assistant."
              rows={3}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className={formLabelClass}>
              Temperature: {Number(values.temperature || 0.7).toFixed(2)}
            </label>
            <input
              className={formRangeClass}
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={Number(values.temperature || 0.7)}
              onChange={(e) => onChange({ ...values, temperature: parseFloat(e.target.value) })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className={formLabelClass}>Max Tokens</label>
            <input
              className={formInputClass}
              type="number"
              value={Number(values.maxTokens || 2048)}
              onChange={(e) => onChange({ ...values, maxTokens: parseInt(e.target.value, 10) })}
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Chat History" icon="📜" defaultOpen={true}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className={formLabelClass}>Limit Chat History</span>
            <button
              onClick={() =>
                onChange({ ...values, chatHistoryLimit: isLimited ? 0 : 10 })
              }
              className={`w-10 h-5.5 rounded-full p-0.5 transition-colors duration-200 outline-none cursor-pointer flex items-center ${
                isLimited ? "bg-accent" : "bg-border-subtle"
              }`}
              style={{ border: isLimited ? "none" : "1px solid var(--border-subtle)" }}
            >
              <div
                className={`w-4.5 h-4.5 rounded-full bg-toggle-knob shadow-md transform transition-transform duration-200 ${
                  isLimited ? "translate-x-4.5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {isLimited && (
            <div className="flex flex-col gap-2 pl-1 animate-[fadeIn_0.15s_ease-out]">
              <label className={formLabelClass}>History Turn Limit (messages)</label>
              <input
                className={formInputClass}
                type="number"
                min="1"
                value={limitValue}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  onChange({
                    ...values,
                    chatHistoryLimit: isNaN(val) || val <= 0 ? 1 : val,
                  });
                }}
                placeholder="e.g. 10"
              />
            </div>
          )}
        </div>
      </CollapsibleSection>
    </>
  );
}
