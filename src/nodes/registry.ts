import {
  TriggerInspector,
  NotifyInspector,
  LLMInspector,
  ChatInspector,
  OutputInspector,
  JSONStorageInspector
} from "@/components/inspectors";
import type { NodeDefinition } from "./types";

export const NODE_REGISTRY: NodeDefinition[] = [
  {
    type: "trigger",
    label: "Trigger",
    icon: "⚡",
    description: "Starts the workflow when clicked",
    defaultData: { label: "Trigger" },
    inspector: TriggerInspector,
  },
  {
    type: "notify",
    label: "Notify",
    icon: "🔔",
    description: "Sends an OS notification",
    defaultData: { label: "Notify", message: "{input.value}", output: "{input.value}" },
    inspector: NotifyInspector,
  },
  {
    type: "llm",
    label: "LLM",
    icon: "🧠",
    description: "Generic LLM inference node",
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
  },
  {
    type: "chat",
    label: "Chat",
    icon: "💬",
    description: "Provides chat input to an agent",
    defaultData: { label: "Chat", messages: [] },
    inspector: ChatInspector,
  },
  {
    type: "outputNode",
    label: "Output",
    icon: "📤",
    description: "Displays the output",
    defaultData: { label: "Output" },
    inspector: OutputInspector,
  },
  {
    type: "output",
    label: "Output",
    icon: "📤",
    description: "Displays the output",
    defaultData: { label: "Output" },
    inspector: OutputInspector,
  },
  {
    type: "jsonStorage",
    label: "JSON Storage",
    icon: "💾",
    description: "Structured JSON file storage for messages and execution logs",
    defaultData: { label: "JSON Storage", records: [] },
    inspector: JSONStorageInspector,
  },
];
