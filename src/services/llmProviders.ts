// Shared LLM provider metadata used by the LLM inspector and the LLM defaults editor.
// Keeping these in one place avoids drift between the two surfaces.

export type ProviderType = "Ollama" | "OpenAI" | "Anthropic" | "Google" | "Other";

// Default base URL applied when a provider is selected.
export const PROVIDER_BASE_URL: Record<ProviderType, string> = {
  Ollama: "http://localhost:11434",
  OpenAI: "https://api.openai.com/v1",
  Anthropic: "https://api.anthropic.com",
  Google: "https://generativelanguage.googleapis.com/v1beta/openai",
  Other: "",
};

// Maps a provider to the credential schema(s) the picker should accept.
// Ollama runs locally and needs no credential, so it gets an empty list.
export const PROVIDER_SCHEMA_TYPES: Record<ProviderType, string[]> = {
  Ollama: [],
  OpenAI: ["openai-api-key"],
  Anthropic: ["anthropic-api-key"],
  Google: ["google-api-key"],
  Other: ["custom-api-key"],
};
