import type { NodePlugin } from "@/engine/plugin";
import { LLMExecutor } from "@/engine/LLMExecutor";
import { LLMInspector } from "@/components/inspectors";
import LLMDefaultsEditor from "@/components/defaults/LLMDefaultsEditor";
import { NODE_COLORS } from "@/theme/colors";

const LLMPlugin: NodePlugin = {
  type: "llm",
  meta: {
    label: "LLM",
    icon: "🧠",
    description: "Generic LLM inference node",
    category: "processing",
    color: NODE_COLORS.llm,
  },
  defaultData: {
    label: "LLM",
    provider: "Ollama",
    modelName: "",
    systemPrompt: "You are a helpful AI assistant.",
    temperature: 0.7,
    maxTokens: 2048,
    baseURL: "http://localhost:11434",
    chatHistoryLimit: 0,
  },
  inspector: LLMInspector,
  defaultsEditor: LLMDefaultsEditor,
  executor: new LLMExecutor(),
  aliases: ["ollama"],
  credentialSchemas: [
    {
      type: "openai-api-key",
      label: "OpenAI API Key",
      provider: "OpenAI",
      icon: "🤖",
      fields: [
        { key: "apiKey", label: "API Key", type: "password", required: true, placeholder: "sk-..." },
      ],
    },
    {
      type: "anthropic-api-key",
      label: "Anthropic API Key",
      provider: "Anthropic",
      icon: "🧠",
      fields: [
        { key: "apiKey", label: "API Key", type: "password", required: true, placeholder: "sk-ant-..." },
      ],
    },
    {
      type: "google-api-key",
      label: "Google (Gemini) API Key",
      provider: "Google",
      icon: "💎",
      fields: [
        { key: "apiKey", label: "API Key", type: "password", required: true, placeholder: "AIza..." },
      ],
    },
    {
      type: "custom-api-key",
      label: "Custom OpenAI-Compatible",
      provider: "Other",
      icon: "🔧",
      fields: [
        { key: "baseURL", label: "Base URL", type: "url", required: true, placeholder: "https://api.yourprovider.com/v1" },
        { key: "apiKey", label: "API Key", type: "password", required: false, placeholder: "Enter API key (optional)" },
      ],
    },
  ],
  // Default handles (target-left, source-right)
  concurrencyPool: (_nodeData) => {
    // Resolved dynamically in LLMExecutor via concurrencyGovernor
    // This is informational; LLMExecutor handles its own pool resolution
    return "cloud";
  },
};

export default LLMPlugin;
