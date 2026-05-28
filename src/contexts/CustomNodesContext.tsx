import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { customNodesService } from "@/services/customNodesService";
import type { CustomNodeDefinition, CustomNodeScope } from "@/types/customNodes";

interface CustomNodesContextValue {
  /** Currently-registered global custom-node definitions. */
  globalDefs: CustomNodeDefinition[];
  /** Currently-registered workspace custom-node definitions (empty on dashboard). */
  workspaceDefs: CustomNodeDefinition[];
  /** Active workspace path, or null on the dashboard / global scope. */
  workspacePath: string | null;
  /** Re-read both scopes from disk and re-register. */
  refresh: () => Promise<void>;
  /** Persist a definition at the given scope, then refresh. */
  saveCustomNode: (scope: CustomNodeScope, def: CustomNodeDefinition) => Promise<void>;
  /** Delete a definition at the given scope, then refresh. */
  deleteCustomNode: (scope: CustomNodeScope, id: string) => Promise<void>;
  /** Move a workspace definition to global scope, then refresh. */
  promoteToGlobal: (id: string) => Promise<void>;
}

const CustomNodesContext = createContext<CustomNodesContextValue | null>(null);

interface ProviderProps {
  /** Null on the dashboard; set when a workspace is open. */
  workspacePath: string | null;
  children: ReactNode;
}

export function CustomNodesProvider({ workspacePath, children }: ProviderProps) {
  const [globalDefs, setGlobalDefs] = useState<CustomNodeDefinition[]>([]);
  const [workspaceDefs, setWorkspaceDefs] = useState<CustomNodeDefinition[]>([]);
  const wsRef = useRef(workspacePath);
  wsRef.current = workspacePath;

  // Global customs: load + register once at app start.
  useEffect(() => {
    let cancelled = false;
    customNodesService.syncGlobal().then((defs) => {
      if (!cancelled) setGlobalDefs(defs);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Workspace customs: swap on workspace enter/leave (clear previous, load new).
  useEffect(() => {
    let cancelled = false;
    customNodesService.syncWorkspace(workspacePath).then((defs) => {
      if (!cancelled) setWorkspaceDefs(defs);
    });
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  const refresh = useCallback(async () => {
    const [g, w] = await Promise.all([
      customNodesService.syncGlobal(true),
      customNodesService.syncWorkspace(wsRef.current, true),
    ]);
    setGlobalDefs(g);
    setWorkspaceDefs(w);
  }, []);

  const saveCustomNode = useCallback(
    async (scope: CustomNodeScope, def: CustomNodeDefinition) => {
      await customNodesService.save(scope, def, wsRef.current);
      await refresh();
    },
    [refresh]
  );

  const deleteCustomNode = useCallback(
    async (scope: CustomNodeScope, id: string) => {
      await customNodesService.remove(scope, id, wsRef.current);
      await refresh();
    },
    [refresh]
  );

  const promoteToGlobal = useCallback(
    async (id: string) => {
      await customNodesService.transfer(id, "workspace", "global", wsRef.current);
      await refresh();
    },
    [refresh]
  );

  const value = useMemo<CustomNodesContextValue>(
    () => ({
      globalDefs,
      workspaceDefs,
      workspacePath,
      refresh,
      saveCustomNode,
      deleteCustomNode,
      promoteToGlobal,
    }),
    [globalDefs, workspaceDefs, workspacePath, refresh, saveCustomNode, deleteCustomNode, promoteToGlobal]
  );

  return <CustomNodesContext.Provider value={value}>{children}</CustomNodesContext.Provider>;
}

export function useCustomNodes(): CustomNodesContextValue {
  const ctx = useContext(CustomNodesContext);
  if (!ctx) {
    // Defensive no-op shape for any consumer mounted outside the provider.
    return {
      globalDefs: [],
      workspaceDefs: [],
      workspacePath: null,
      refresh: async () => {},
      saveCustomNode: async () => {},
      deleteCustomNode: async () => {},
      promoteToGlobal: async () => {},
    };
  }
  return ctx;
}
