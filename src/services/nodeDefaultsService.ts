import { api, type NodeDefaultsConfig, type ModelEntry } from "./api";
import { normalizeProvider, type ProviderKey } from "./builtInModels";

export type DefaultsScope = "global" | "workspace";

// In-memory caches keyed by scope. Workspace cache is keyed by workspace path.
let globalCache: NodeDefaultsConfig | null = null;
const workspaceCache = new Map<string, NodeDefaultsConfig>();

async function ensureGlobal(): Promise<NodeDefaultsConfig> {
  if (globalCache) return globalCache;
  // The backend returns an empty config for a missing file, so a thrown error here is a
  // genuine failure (corruption / unreadable / IPC). Don't cache empty — that would let a
  // subsequent save overwrite the real file with a blank document. Surface it instead.
  let cfg: NodeDefaultsConfig;
  try {
    cfg = await api.loadGlobalNodeDefaults();
  } catch (err) {
    console.error("Failed to load global node defaults:", err);
    throw err;
  }
  // Defensive: backend may return null/undefined fields on first load.
  cfg.defaults = cfg.defaults ?? {};
  cfg.models = cfg.models ?? {};
  globalCache = cfg;
  return globalCache;
}

async function ensureWorkspace(workspacePath: string): Promise<NodeDefaultsConfig> {
  const cached = workspaceCache.get(workspacePath);
  if (cached) return cached;
  let cfg: NodeDefaultsConfig;
  try {
    cfg = await api.loadWorkspaceNodeDefaults(workspacePath);
  } catch (err) {
    console.error("Failed to load workspace node defaults:", err);
    throw err;
  }
  cfg.defaults = cfg.defaults ?? {};
  cfg.models = cfg.models ?? {};
  workspaceCache.set(workspacePath, cfg);
  return cfg;
}

export const nodeDefaultsService = {
  /** Force-reload caches from disk. */
  invalidate(workspacePath?: string | null) {
    globalCache = null;
    if (workspacePath) workspaceCache.delete(workspacePath);
    else workspaceCache.clear();
  },

  async loadGlobal(): Promise<NodeDefaultsConfig> {
    return ensureGlobal();
  },

  async loadWorkspace(workspacePath: string): Promise<NodeDefaultsConfig> {
    return ensureWorkspace(workspacePath);
  },

  async saveGlobal(cfg: NodeDefaultsConfig): Promise<void> {
    await api.saveGlobalNodeDefaults(cfg);
    globalCache = cfg;
  },

  async saveWorkspace(workspacePath: string, cfg: NodeDefaultsConfig): Promise<void> {
    await api.saveWorkspaceNodeDefaults(workspacePath, cfg);
    workspaceCache.set(workspacePath, cfg);
  },

  /**
   * Returns the shallow-merged override for a plugin type:
   *   globalDefaults[type] ⊕ workspaceDefaults[type]
   * (workspace wins). Caller is expected to spread this on top of
   * plugin.defaultData at node-create time.
   */
  async getMergedOverrides(
    type: string,
    workspacePath: string | null
  ): Promise<Record<string, unknown>> {
    const global = await ensureGlobal();
    const workspace = workspacePath ? await ensureWorkspace(workspacePath) : null;
    return {
      ...(global.defaults[type] ?? {}),
      ...(workspace?.defaults[type] ?? {}),
    };
  },

  /** Set the override blob for a plugin type at the given scope. */
  async setDefaultsForType(
    scope: DefaultsScope,
    type: string,
    values: Record<string, unknown>,
    workspacePath: string | null
  ): Promise<void> {
    if (scope === "global") {
      const cfg = await ensureGlobal();
      cfg.defaults = { ...cfg.defaults, [type]: values };
      await this.saveGlobal(cfg);
    } else {
      if (!workspacePath) throw new Error("workspacePath required for workspace scope");
      const cfg = await ensureWorkspace(workspacePath);
      cfg.defaults = { ...cfg.defaults, [type]: values };
      await this.saveWorkspace(workspacePath, cfg);
    }
  },

  /** Clear the override blob for a plugin type (revert to plugin default). */
  async clearDefaultsForType(
    scope: DefaultsScope,
    type: string,
    workspacePath: string | null
  ): Promise<void> {
    if (scope === "global") {
      const cfg = await ensureGlobal();
      const { [type]: _drop, ...rest } = cfg.defaults;
      cfg.defaults = rest;
      await this.saveGlobal(cfg);
    } else {
      if (!workspacePath) throw new Error("workspacePath required for workspace scope");
      const cfg = await ensureWorkspace(workspacePath);
      const { [type]: _drop, ...rest } = cfg.defaults;
      cfg.defaults = rest;
      await this.saveWorkspace(workspacePath, cfg);
    }
  },

  /** Returns user-added models at the given scope for the given provider. */
  async listModels(
    scope: DefaultsScope,
    provider: ProviderKey,
    workspacePath: string | null
  ): Promise<ModelEntry[]> {
    if (scope === "global") {
      const cfg = await ensureGlobal();
      return cfg.models[provider] ?? [];
    }
    if (!workspacePath) return [];
    const cfg = await ensureWorkspace(workspacePath);
    return cfg.models[provider] ?? [];
  },

  /** Add a user model under the given scope/provider. No-op if duplicate. */
  async addModel(
    scope: DefaultsScope,
    provider: ProviderKey,
    name: string,
    workspacePath: string | null
  ): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    const cfg =
      scope === "global"
        ? await ensureGlobal()
        : (workspacePath
            ? await ensureWorkspace(workspacePath)
            : (() => {
                throw new Error("workspacePath required for workspace scope");
              })());
    const list = cfg.models[provider] ?? [];
    if (list.some((m) => m.name === trimmed)) return;
    cfg.models = {
      ...cfg.models,
      [provider]: [...list, { name: trimmed, added_at: new Date().toISOString() }],
    };
    if (scope === "global") await this.saveGlobal(cfg);
    else await this.saveWorkspace(workspacePath!, cfg);
  },

  /** Remove a user model at the given scope/provider. */
  async removeModel(
    scope: DefaultsScope,
    provider: ProviderKey,
    name: string,
    workspacePath: string | null
  ): Promise<void> {
    const cfg =
      scope === "global"
        ? await ensureGlobal()
        : (workspacePath
            ? await ensureWorkspace(workspacePath)
            : (() => {
                throw new Error("workspacePath required for workspace scope");
              })());
    const list = cfg.models[provider] ?? [];
    cfg.models = { ...cfg.models, [provider]: list.filter((m) => m.name !== name) };
    if (scope === "global") await this.saveGlobal(cfg);
    else await this.saveWorkspace(workspacePath!, cfg);
  },
};

export { normalizeProvider };
export type { ProviderKey };
