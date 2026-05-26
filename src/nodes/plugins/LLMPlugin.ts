import type { NodePlugin } from "@/engine/plugin";
import { LLMExecutor } from "@/engine/LLMExecutor";
import { LLMInspector } from "@/components/inspectors";

const LLMPlugin: NodePlugin = {
  type: "llm",
  meta: {
    label: "LLM",
    icon: "🧠",
    description: "Generic LLM inference node",
    category: "processing",
    color: "#a78bfa",
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
  executor: new LLMExecutor(),
  aliases: ["ollama"],
  // Default handles (target-left, source-right)
  concurrencyPool: (_nodeData) => {
    // Resolved dynamically in LLMExecutor via concurrencyGovernor
    // This is informational; LLMExecutor handles its own pool resolution
    return "cloud";
  },
};

export default LLMPlugin;
