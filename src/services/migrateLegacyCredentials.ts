import { api } from "./api";
import { credentialService } from "./credentialService";

// One-time migration: scan every space's LLM nodes for inline `apiKey` strings,
// move them into the workspace's local credential vault, and replace the inline
// value with `credentialId`. Idempotent — safe to call on every load. A space
// with no inline keys is a no-op and is not re-saved.

const SUPPORTED_LLM_TYPES = new Set(["llm", "ollama"]);

interface MigrationOutcome {
  migratedNodes: number;
  newCredentials: number;
}

// Maps provider name (case-insensitive) to the credential schema type to use.
// Custom/Other gets the catch-all schema that includes baseURL alongside the key.
function schemaTypeForProvider(provider: string): {
  schemaType: string;
  providerLabel: string;
} {
  const p = provider.toLowerCase();
  if (p === "openai") return { schemaType: "openai-api-key", providerLabel: "OpenAI" };
  if (p === "anthropic")
    return { schemaType: "anthropic-api-key", providerLabel: "Anthropic" };
  if (p === "google") return { schemaType: "google-api-key", providerLabel: "Google" };
  return { schemaType: "custom-api-key", providerLabel: "Other" };
}

export async function migrateLegacyCredentials(
  workspacePath: string,
  spaceIds: string[]
): Promise<MigrationOutcome> {
  let migratedNodes = 0;
  let newCredentials = 0;
  // Dedupe identical (provider, key) pairs across the workspace so two LLM
  // nodes with the same key produce a single vault entry.
  const cache = new Map<string, string>(); // `${provider}|${apiKey}` -> credentialId

  for (const spaceId of spaceIds) {
    const space = await api.loadSpace(workspacePath, spaceId);
    let dirty = false;

    for (const node of space.nodes) {
      if (!SUPPORTED_LLM_TYPES.has(node.type)) continue;
      const data = node.data as Record<string, unknown> | undefined;
      if (!data) continue;
      const inlineKey =
        typeof data.apiKey === "string" ? (data.apiKey as string) : "";
      const existingCredId =
        typeof data.credentialId === "string"
          ? (data.credentialId as string)
          : "";

      // Already migrated for this node, or nothing to migrate.
      if (!inlineKey.trim() || existingCredId) {
        if (inlineKey && existingCredId) {
          // Clean up the stale inline key so it isn't sitting on disk.
          delete (data as Record<string, unknown>).apiKey;
          dirty = true;
        }
        continue;
      }

      const provider =
        typeof data.provider === "string" ? (data.provider as string) : "OpenAI";
      const { schemaType, providerLabel } = schemaTypeForProvider(provider);

      // Some providers ("Other") may have an additional baseURL field that we
      // should also lift into the credential so post-migration users can change
      // the key without re-typing the URL.
      const baseURL =
        schemaType === "custom-api-key" && typeof data.baseURL === "string"
          ? (data.baseURL as string)
          : "";

      const cacheKey = `${schemaType}|${inlineKey}|${baseURL}`;
      let credentialId = cache.get(cacheKey);

      if (!credentialId) {
        const meta = await credentialService.add(
          "local",
          `${providerLabel} (migrated)`,
          schemaType,
          providerLabel,
          baseURL ? { apiKey: inlineKey, baseURL } : { apiKey: inlineKey },
          workspacePath
        );
        credentialId = meta.id;
        cache.set(cacheKey, credentialId);
        newCredentials++;
      }

      (data as Record<string, unknown>).credentialId = credentialId;
      delete (data as Record<string, unknown>).apiKey;
      migratedNodes++;
      dirty = true;
    }

    if (dirty) {
      await api.saveSpace(workspacePath, space);
    }
  }

  return { migratedNodes, newCredentials };
}
