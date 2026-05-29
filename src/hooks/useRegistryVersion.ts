import { useSyncExternalStore } from "react";
import { pluginRegistry } from "@/engine/pluginRegistry";

/**
 * Subscribe a component to plugin-registry mutations. Returns the registry's
 * monotonic version, so adding it to a `useMemo` dependency list forces consumers
 * (palette, node-types map, Nodes tab) to re-read the registry when custom nodes
 * are registered or unregistered at runtime.
 */
export function useRegistryVersion(): number {
  return useSyncExternalStore(pluginRegistry.subscribe, pluginRegistry.getVersion);
}
