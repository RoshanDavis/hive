import type { InspectorProps } from "./types";
import type { NodeOutputEnvelope } from "@/engine/types";
import DataConsole from "./shared/DataConsole";
import CredentialPicker from "./shared/CredentialPicker";
import ModelPicker from "./shared/ModelPicker";
import CollapsibleSection from "./CollapsibleSection";
import InspectorActions from "./InspectorActions";
import { formLabelClass, formInputClass, formRangeClass } from "@/components/shared/FormField";
import {
  PROVIDER_BASE_URL,
  PROVIDER_SCHEMA_TYPES,
  type ProviderType,
} from "@/services/llmProviders";

export default function LLMInspector({
  node,
  onUpdate,
  workspacePath,
  onSaveAsCustom,
  onDeleteNode,
}: InspectorProps) {
  const provider = (node.data?.provider || "Ollama") as ProviderType;

  // Resolve current values with sensible defaults and backward-compatibility fallbacks
  const baseURLValue = String(node.data?.baseURL ?? (provider === "Ollama" ? "http://localhost:11434" : ""));
  const modelNameValue = String(node.data?.modelName ?? "");
  const credentialId = (node.data?.credentialId as string | undefined) ?? null;

  const limitValue = Number(node.data?.chatHistoryLimit || 0);
  const isLimited = limitValue > 0;

  const lastValue = (node.data?.outputEnvelope as NodeOutputEnvelope | undefined)?.value;
  const hasLastResponse = lastValue !== undefined && lastValue !== null && String(lastValue) !== "";

  const handleProviderChange = (newProvider: ProviderType) => {
    const updatedData = { ...node.data };
    updatedData.provider = newProvider;
    updatedData.baseURL = PROVIDER_BASE_URL[newProvider];
    updatedData.modelName = "";

    // A credential belongs to the provider it was created for. On any provider change,
    // drop the stale reference so execution can't send the wrong secret to the new
    // provider; the user re-selects/creates one via the picker.
    if (credentialId && newProvider !== provider) {
      delete updatedData.credentialId;
    }

    onUpdate(node.id, updatedData);
  };

  const showBaseURL = provider === "Ollama" || provider === "Other";
  const schemaTypes = PROVIDER_SCHEMA_TYPES[provider];

  return (
    <div className="flex flex-col gap-3">
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
                onChange={(e) =>
                  onUpdate(node.id, {
                    ...node.data,
                    baseURL: e.target.value,
                  })
                }
              />
            </div>
          )}

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
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Model" icon="🧠" defaultOpen={true}>
        <ModelPicker
          provider={provider}
          selectedModel={modelNameValue}
          onSelect={(name) =>
            onUpdate(node.id, {
              ...node.data,
              modelName: name,
            })
          }
          workspacePath={workspacePath}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Parameters" icon="⚙️" defaultOpen={true}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className={formLabelClass}>System Prompt</label>
            <textarea
              className={`${formInputClass} resize-y min-h-20 font-inherit`}
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
            <label className={formLabelClass}>
              Temperature: {Number(node.data?.temperature || 0.7).toFixed(2)}
            </label>
            <input
              className={formRangeClass}
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
            <label className={formLabelClass}>Max Tokens</label>
            <input
              className={formInputClass}
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
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Chat History" icon="📜" defaultOpen={true}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className={formLabelClass}>Limit Chat History</span>
            <button
              onClick={() => {
                onUpdate(node.id, {
                  ...node.data,
                  chatHistoryLimit: isLimited ? 0 : 10,
                });
              }}
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
      </CollapsibleSection>

      <CollapsibleSection
        title="Last Response"
        icon="💬"
        defaultOpen={hasLastResponse}
        badge={hasLastResponse ? String(lastValue).length : undefined}
      >
        {hasLastResponse ? (
          <div className="flex flex-col gap-2">
            <div className="flex justify-end">
              <button
                onClick={() => onUpdate(node.id, { ...node.data, outputEnvelope: undefined })}
                className="text-[10px] text-text-muted hover:text-danger transition-colors cursor-pointer border-none bg-transparent"
                title="Clear response"
              >
                Clear
              </button>
            </div>
            <DataConsole content={String(lastValue)} />
          </div>
        ) : (
          <div className="text-[11px] text-text-muted py-2 text-center select-none">
            No response yet.
          </div>
        )}
      </CollapsibleSection>

      <InspectorActions onSaveAsCustom={onSaveAsCustom} onDeleteNode={onDeleteNode} />
    </div>
  );
}
