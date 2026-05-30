import { api } from "./api";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { synthesizePlugin } from "./customNodeLoader";
import { customTypeFor, type CustomNodeDefinition, type CustomNodeScope } from "@/types/customNodes";

// In-memory caches. Global is a single list; workspace is keyed by path.
let globalCache: CustomNodeDefinition[] | null = null;
const workspaceCache = new Map<string, CustomNodeDefinition[]>();
// Monotonic generation for syncWorkspaces — a stale (older) load cannot
// overwrite the registry once a newer call has started.
let workspaceSyncToken = 0;

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
    const plugin = synthesizePlugin(def, scope);
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
   *
   * Kept for compatibility with single-workspace UI flows (the settings panel
   * still loads one workspace's defs at a time). Background execution uses
   * `syncWorkspaces([...paths])` instead so multiple live workspaces can
   * keep their script/preset nodes registered concurrently.
   */
  async syncWorkspace(path: string | null, force = false): Promise<CustomNodeDefinition[]> {
    pluginRegistry.clearCustomsByScope("workspace");
    if (!path) return [];
    const defs = await loadWorkspace(path, force);
    registerDefs(defs, "workspace");
    return defs;
  },

  /**
   * Multi-workspace sync: register the union of all given workspaces' custom
   * plugins. Used by BackgroundRunnersContext so a backgrounded workspace's
   * script nodes continue to resolve while another workspace is in the
   * foreground. Race-safe via a generation token: a stale concurrent load
   * cannot overwrite a newer one.
   */
  async syncWorkspaces(paths: string[]): Promise<void> {
    const myToken = ++workspaceSyncToken;
    const defsByPath = await Promise.all(
      paths.map(async (p) => ({ path: p, defs: await loadWorkspace(p, false) }))
    );
    if (myToken !== workspaceSyncToken) return;
    pluginRegistry.clearCustomsByScope("workspace");
    for (const { defs } of defsByPath) {
      registerDefs(defs, "workspace");
    }
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
