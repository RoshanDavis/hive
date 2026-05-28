import type { ComponentType } from "react";
import type { NodePlugin } from "./plugin";
import type { NodeExecutor } from "./types";
import type { NodeDefinition } from "@/nodes/types";
import type { CredentialSchema } from "@/types/credentialTypes";

class PluginRegistry {
  private plugins = new Map<string, NodePlugin>();

  /** Register a plugin under its type and any aliases */
  register(plugin: NodePlugin): void {
    this.plugins.set(plugin.type, plugin);
    if (plugin.aliases) {
      for (const alias of plugin.aliases) {
        this.plugins.set(alias, plugin);
      }
    }
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

  /** Get the color for a node type */
  getColor(type: string): string {
    return this.plugins.get(type)?.meta.color || "#888";
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
