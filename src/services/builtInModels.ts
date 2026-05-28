// Curated built-in model lists per provider. Used by ModelPicker to populate
// the ⭐ Built-in optgroup. Users can add their own models on top of these
// via the inline "+ Add new" form (stored in global or workspace node defaults).

export type ProviderKey = "ollama" | "openai" | "anthropic" | "google" | "other";

export const BUILT_IN_MODELS: Record<ProviderKey, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "claude-3-5-sonnet-latest",
  ],
  google: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  ollama: [],
  other: [],
};

// Maps the inspector's provider string (mixed case) to a ProviderKey.
export function normalizeProvider(provider: string): ProviderKey {
  const lower = provider.toLowerCase();
  if (lower === "ollama" || lower === "openai" || lower === "anthropic" || lower === "google") {
    return lower;
  }
  return "other";
}
