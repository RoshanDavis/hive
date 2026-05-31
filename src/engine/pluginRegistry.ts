import type { ComponentType } from "react";
import type { NodePlugin } from "./plugin";
import type { NodeExecutor } from "./types";
import type { NodeDefinition } from "@/nodes/types";
import type { CredentialSchema } from "@/types/credentialTypes";

export type CustomScope = "global" | "workspace";

class PluginRegistry {
  private plugins = new Map<string, NodePlugin>();
  /** Tracks which dynamically-registered types are custom, and at what scope. */
  private customScopes = new Map<string, CustomScope>();

  // ─── Reactivity: version signal for useSyncExternalStore consumers ───
  private version = 0;
  private listeners = new Set<() => void>();

  private bump(): void {
    this.version += 1;
    for (const cb of this.listeners) cb();
  }

  /** Subscribe to registry changes (register/unregister). Returns an unsubscribe fn. */
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  /** Monotonic version, bumped on every registry mutation. */
  getVersion = (): number => this.version;

  /** Register a plugin under its type. */
  register(plugin: NodePlugin): void {
    this.plugins.set(plugin.type, plugin);
  }

  /** Register (or replace) a runtime custom-node plugin at the given scope. */
  registerCustom(plugin: NodePlugin, scope: CustomScope): void {
    this.plugins.set(plugin.type, plugin);
    this.customScopes.set(plugin.type, scope);
    this.bump();
  }

  /** Remove a single custom plugin by type. No-op for built-ins. */
  unregisterCustom(type: string): void {
    if (!this.customScopes.has(type)) return;
    this.plugins.delete(type);
    this.customScopes.delete(type);
    this.bump();
  }

  /** Remove every custom plugin registered at the given scope (e.g. on workspace leave). */
  clearCustomsByScope(scope: CustomScope): void {
    let changed = false;
    for (const [type, s] of this.customScopes.entries()) {
      if (s === scope) {
        this.plugins.delete(type);
        this.customScopes.delete(type);
        changed = true;
      }
    }
    if (changed) this.bump();
  }

  /** Whether a type was registered as a custom node (any scope). */
  isCustom(type: string): boolean {
    return this.customScopes.has(type);
  }

  /** Get a plugin by type or alias */
  get(type: string): NodePlugin | undefined {
    return this.plugins.get(type);
  }

  /** Get all unique plugins (no alias duplicates) */
  getAll(): NodePlugin[] {
    const seen = new Set<NodePlugin>();
    for (const plugin of this.plugins.values()) {
      seen.add(plugin);
    }
    return Array.from(seen);
  }

  /** Get the executor for a node type */
  getExecutor(type: string): NodeExecutor | undefined {
    return this.plugins.get(type)?.executor;
  }

  /** Get the icon for a node type */
  getIcon(type: string): string {
    return this.plugins.get(type)?.meta.icon || "📦";
  }

  /** Get node definitions for the palette (unique plugins only) */
  getNodeDefinitions(): NodeDefinition[] {
    return this.getAll().map((plugin) => ({
      type: plugin.type,
      label: plugin.meta.label,
      icon: plugin.meta.icon,
      description: plugin.meta.description,
      defaultData: plugin.defaultData,
      inspector: plugin.inspector,
    }));
  }

  /** Build the nodeTypes map for React Flow */
  getNodeTypesMap(
    fallbackComponent: ComponentType<any>,
  ): Record<string, ComponentType<any>> {
    const map: Record<string, ComponentType<any>> = {};
    for (const [key, plugin] of this.plugins.entries()) {
      map[key] = plugin.component || fallbackComponent;
    }
    return map;
  }

  /** Collect all credential schemas across all registered plugins (deduped by type). */
  getCredentialSchemas(): CredentialSchema[] {
    const byType = new Map<string, CredentialSchema>();
    for (const plugin of this.getAll()) {
      for (const schema of plugin.credentialSchemas || []) {
        byType.set(schema.type, schema);
      }
    }
    return Array.from(byType.values());
  }
}

export const pluginRegistry = new PluginRegistry();
