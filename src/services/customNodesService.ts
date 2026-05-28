import { api } from "./api";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { synthesizePlugin } from "./customNodeLoader";
import { customTypeFor, type CustomNodeDefinition, type CustomNodeScope } from "@/types/customNodes";

// In-memory caches. Global is a single list; workspace is keyed by path.
let globalCache: CustomNodeDefinition[] | null = null;
const workspaceCache = new Map<string, CustomNodeDefinition[]>();

async function loadGlobal(force = false): Promise<CustomNodeDefinition[]> {
  if (!force && globalCache) return globalCache;
  try {
    globalCache = await api.listGlobalCustomNodes();
  } catch {
    globalCache = [];
  }
  return globalCache;
}

async function loadWorkspace(path: string, force = false): Promise<CustomNodeDefinition[]> {
  if (!force) {
    const cached = workspaceCache.get(path);
    if (cached) return cached;
  }
  let defs: CustomNodeDefinition[];
  try {
    defs = await api.listWorkspaceCustomNodes(path);
  } catch {
    defs = [];
  }
  workspaceCache.set(path, defs);
  return defs;
}

function registerDefs(defs: CustomNodeDefinition[], scope: CustomNodeScope): void {
  for (const def of defs) {
    const plugin = synthesizePlugin(def);
    if (plugin) pluginRegistry.registerCustom(plugin, scope);
  }
}

export const customNodesService = {
  /** Drop caches so the next load re-reads disk. */
  invalidate(workspacePath?: string | null): void {
    globalCache = null;
    if (workspacePath) workspaceCache.delete(workspacePath);
    else workspaceCache.clear();
  },

  /** Clear + re-register all global custom plugins. Returns the def list. */
  async syncGlobal(force = false): Promise<CustomNodeDefinition[]> {
    const defs = await loadGlobal(force);
    pluginRegistry.clearCustomsByScope("global");
    registerDefs(defs, "global");
    return defs;
  },

  /**
   * Swap workspace custom plugins: clear the previous workspace's, then register
   * the new one's. Passing `null` (e.g. on the dashboard) just clears.
   */
  async syncWorkspace(path: string | null, force = false): Promise<CustomNodeDefinition[]> {
    pluginRegistry.clearCustomsByScope("workspace");
    if (!path) return [];
    const defs = await loadWorkspace(path, force);
    registerDefs(defs, "workspace");
    return defs;
  },

  async save(
    scope: CustomNodeScope,
    def: CustomNodeDefinition,
    workspacePath: string | null
  ): Promise<void> {
    if (scope === "global") {
      await api.saveGlobalCustomNode(def);
    } else {
      if (!workspacePath) throw new Error("workspacePath required for workspace scope");
      await api.saveWorkspaceCustomNode(workspacePath, def);
    }
    this.invalidate(workspacePath);
  },

  async remove(
    scope: CustomNodeScope,
    id: string,
    workspacePath: string | null
  ): Promise<void> {
    if (scope === "global") {
      await api.deleteGlobalCustomNode(id);
    } else {
      if (!workspacePath) throw new Error("workspacePath required for workspace scope");
      await api.deleteWorkspaceCustomNode(workspacePath, id);
    }
    // The plugin may still be registered — drop it immediately for snappy UI.
    pluginRegistry.unregisterCustom(customTypeFor(id));
    this.invalidate(workspacePath);
  },

  async transfer(
    id: string,
    fromScope: CustomNodeScope,
    toScope: CustomNodeScope,
    workspacePath: string | null
  ): Promise<void> {
    await api.customNodeTransfer(id, fromScope, toScope, workspacePath);
    this.invalidate(workspacePath);
  },
};
