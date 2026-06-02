import type { LLMNodeData } from "./types";

/**
 * Default data for a new LLM node, and the seed for an Agent's LLM slot. Kept in
 * a neutral module (no plugin/inspector imports) so both LLMPlugin and
 * AgentInspector can share it without an import cycle through the inspectors
 * barrel.
 */
export const LLM_DEFAULT_DATA: LLMNodeData = {
  label: "LLM",
  provider: "Ollama",
  modelName: "",
  systemPrompt: "You are a helpful AI assistant.",
  temperature: 0.7,
  maxTokens: 2048,
  baseURL: "http://localhost:11434",
  chatHistoryLimit: 0,
};
