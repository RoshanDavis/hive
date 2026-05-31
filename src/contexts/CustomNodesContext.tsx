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
import { useBackgroundRunners } from "@/contexts/BackgroundRunnersContext";

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

  // BackgroundRunnersContext supplies the set of live workspaces (foreground
  // + any retained background sessions). We keep all of their custom nodes
  // registered concurrently so script/preset nodes resolve during background
  // runs.
  const runners = useBackgroundRunners();

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

  // Live-workspace customs: re-sync whenever a session is created or disposed.
  // The set we send is the union of the live sessions plus the foreground
  // `workspacePath` prop (which is always in the live set anyway when an
  // editor is mounted, but including it eagerly avoids a race where the prop
  // arrives before the session-create notify lands).
  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      const live = runners.getLiveWorkspacePaths();
      const paths = workspacePath ? Array.from(new Set([...live, workspacePath])) : live;
      void customNodesService.syncWorkspaces(paths).then(() => {
        if (!cancelled && workspacePath) {
          // Surface only the foreground workspace's defs to the UI panel; that
          // matches the single-workspace settings UX (the panel always shows
          // the current workspace, not the union).
          customNodesService.syncWorkspace(workspacePath, false).then((defs) => {
            // syncWorkspace clears workspace scope and registers only that
            // workspace's, which is wrong for our multi-live model. Re-apply
            // the union immediately afterwards. This is mildly wasteful but
            // happens rarely (only on live-set change) and keeps the UI list
            // in sync with disk.
            if (cancelled) return;
            setWorkspaceDefs(defs);
            void customNodesService.syncWorkspaces(paths);
          });
        } else if (!cancelled) {
          setWorkspaceDefs([]);
        }
      });
    };
    sync();
    const unsub = runners.subscribeLive(sync);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [workspacePath, runners]);

  const refresh = useCallback(async () => {
    const live = runners.getLiveWorkspacePaths();
    const paths = wsRef.current
      ? Array.from(new Set([...live, wsRef.current]))
      : live;
    const [g] = await Promise.all([
      customNodesService.syncGlobal(true),
      customNodesService.syncWorkspaces(paths),
    ]);
    setGlobalDefs(g);
    if (wsRef.current) {
      // Reload just the foreground workspace's defs for the UI list, then
      // re-apply the union so background workspaces stay registered.
      const w = await customNodesService.syncWorkspace(wsRef.current, true);
      setWorkspaceDefs(w);
      await customNodesService.syncWorkspaces(paths);
    } else {
      setWorkspaceDefs([]);
    }
  }, [runners]);

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
