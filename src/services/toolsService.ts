import { api, type ToolsConfig, type ToolDef } from "./api";
import { builtInToolsFor, type ToolCategory } from "./builtInTools";

// Scope-aware façade over the tools registry (built-in + global + workspace),
// mirroring nodeDefaultsService. Built-in tools are always available; users add
// their own per scope. In-memory caches avoid re-reading disk on every render.

export type ToolsScope = "global" | "workspace";

let globalCache: ToolsConfig | null = null;
const workspaceCache = new Map<string, ToolsConfig>();

function normalize(cfg: ToolsConfig): ToolsConfig {
  cfg.native = cfg.native ?? [];
  cfg.mcp = cfg.mcp ?? [];
  cfg.skills = cfg.skills ?? [];
  return cfg;
}

async function ensureGlobal(): Promise<ToolsConfig> {
  if (globalCache) return globalCache;
  globalCache = normalize(await api.loadGlobalTools());
  return globalCache;
}

async function ensureWorkspace(workspacePath: string): Promise<ToolsConfig> {
  const cached = workspaceCache.get(workspacePath);
  if (cached) return cached;
  const cfg = normalize(await api.loadWorkspaceTools(workspacePath));
  workspaceCache.set(workspacePath, cfg);
  return cfg;
}

/** De-dupe by id, preserving first occurrence (built-in wins over user dupes). */
function dedupeById(tools: ToolDef[]): ToolDef[] {
  const seen = new Set<string>();
  const out: ToolDef[] = [];
  for (const t of tools) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

export const toolsService = {
  /** Force-reload caches from disk. */
  invalidate(workspacePath?: string | null) {
    globalCache = null;
    if (workspacePath) workspaceCache.delete(workspacePath);
    else workspaceCache.clear();
  },

  /** User-defined tools for a category, split by scope (excludes built-ins, which
   * aren't on disk). Used by the Tools settings panel to render + manage them. */
  async listUserTools(
    category: ToolCategory,
    workspacePath: string | null
  ): Promise<{ global: ToolDef[]; workspace: ToolDef[] }> {
    const global = await ensureGlobal();
    const workspace = workspacePath ? await ensureWorkspace(workspacePath) : null;
    return { global: global[category], workspace: workspace ? workspace[category] : [] };
  },

  /** Built-in ⊕ global ⊕ workspace tools for a category (de-duped by id). */
  async getAvailable(category: ToolCategory, workspacePath: string | null): Promise<ToolDef[]> {
    const global = await ensureGlobal();
    const workspace = workspacePath ? await ensureWorkspace(workspacePath) : null;
    return dedupeById([
      ...builtInToolsFor(category),
      ...global[category],
      ...(workspace ? workspace[category] : []),
    ]);
  },

  /** True if an id is a built-in (and therefore can't be removed). */
  isBuiltIn(category: ToolCategory, id: string): boolean {
    return builtInToolsFor(category).some((t) => t.id === id);
  },

  /** Which on-disk scope holds a user tool id (workspace shadows global), or null
   * if it's only a built-in / not found. Used to locate a skill's SKILL.md body. */
  async scopeOf(
    category: ToolCategory,
    id: string,
    workspacePath: string | null
  ): Promise<ToolsScope | null> {
    if (workspacePath) {
      const ws = await ensureWorkspace(workspacePath);
      if (ws[category].some((t) => t.id === id)) return "workspace";
    }
    const global = await ensureGlobal();
    if (global[category].some((t) => t.id === id)) return "global";
    return null;
  },

  /** Add a user tool at the given scope. No-op on duplicate id within that scope. */
  async addTool(
    scope: ToolsScope,
    category: ToolCategory,
    def: ToolDef,
    workspacePath: string | null
  ): Promise<void> {
    if (scope === "workspace" && !workspacePath) {
      throw new Error("workspacePath required for workspace scope");
    }
    const cfg = scope === "global" ? await ensureGlobal() : await ensureWorkspace(workspacePath!);
    if (cfg[category].some((t) => t.id === def.id)) return;
    cfg[category] = [...cfg[category], def];
    if (scope === "global") await this.saveGlobal(cfg);
    else await this.saveWorkspace(workspacePath!, cfg);
  },

  /** Replace an existing user tool by id, in whichever scope holds it (built-ins
   * are not on disk, so they're never matched). No-op if the id isn't found. */
  async updateTool(
    category: ToolCategory,
    def: ToolDef,
    workspacePath: string | null
  ): Promise<void> {
    const global = await ensureGlobal();
    if (global[category].some((t) => t.id === def.id)) {
      global[category] = global[category].map((t) => (t.id === def.id ? def : t));
      await this.saveGlobal(global);
      return;
    }
    if (workspacePath) {
      const ws = await ensureWorkspace(workspacePath);
      if (ws[category].some((t) => t.id === def.id)) {
        ws[category] = ws[category].map((t) => (t.id === def.id ? def : t));
        await this.saveWorkspace(workspacePath, ws);
      }
    }
  },

  /** Remove a user tool from both scopes (built-ins are unaffected — not on disk). */
  async removeTool(
    category: ToolCategory,
    id: string,
    workspacePath: string | null
  ): Promise<void> {
    const global = await ensureGlobal();
    if (global[category].some((t) => t.id === id)) {
      global[category] = global[category].filter((t) => t.id !== id);
      await this.saveGlobal(global);
    }
    if (workspacePath) {
      const ws = await ensureWorkspace(workspacePath);
      if (ws[category].some((t) => t.id === id)) {
        ws[category] = ws[category].filter((t) => t.id !== id);
        await this.saveWorkspace(workspacePath, ws);
      }
    }
  },

  async saveGlobal(cfg: ToolsConfig): Promise<void> {
    await api.saveGlobalTools(cfg);
    globalCache = cfg;
  },

  async saveWorkspace(workspacePath: string, cfg: ToolsConfig): Promise<void> {
    await api.saveWorkspaceTools(workspacePath, cfg);
    workspaceCache.set(workspacePath, cfg);
  },
};

export type { ToolCategory };
