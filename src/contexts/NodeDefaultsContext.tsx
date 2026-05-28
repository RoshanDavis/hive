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
import { nodeDefaultsService } from "@/services/nodeDefaultsService";
import type { NodeDefaultsConfig } from "@/services/api";

interface NodeDefaultsContextValue {
  /** Merged override blob for a plugin type (global ⊕ workspace). Read synchronously from cached state. */
  getMergedOverrides: (type: string) => Record<string, unknown>;
  /** Re-fetch caches from disk and rebuild the merged map. */
  refresh: () => Promise<void>;
  /** Raw configs (for editors that need to read/write specific scopes). */
  global: NodeDefaultsConfig;
  workspace: NodeDefaultsConfig;
}

const NodeDefaultsContext = createContext<NodeDefaultsContextValue | null>(null);

const EMPTY: NodeDefaultsConfig = { version: 1, defaults: {}, models: {} };

interface ProviderProps {
  workspacePath: string;
  children: ReactNode;
}

export function NodeDefaultsProvider({ workspacePath, children }: ProviderProps) {
  const [global, setGlobal] = useState<NodeDefaultsConfig>(EMPTY);
  const [workspace, setWorkspace] = useState<NodeDefaultsConfig>(EMPTY);
  const wsRef = useRef(workspacePath);
  wsRef.current = workspacePath;

  const refresh = useCallback(async () => {
    nodeDefaultsService.invalidate(wsRef.current);
    const [g, w] = await Promise.all([
      nodeDefaultsService.loadGlobal(),
      nodeDefaultsService.loadWorkspace(wsRef.current),
    ]);
    setGlobal(g);
    setWorkspace(w);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, workspacePath]);

  const getMergedOverrides = useCallback(
    (type: string): Record<string, unknown> => ({
      ...(global.defaults?.[type] ?? {}),
      ...(workspace.defaults?.[type] ?? {}),
    }),
    [global, workspace]
  );

  const value = useMemo<NodeDefaultsContextValue>(
    () => ({ getMergedOverrides, refresh, global, workspace }),
    [getMergedOverrides, refresh, global, workspace]
  );

  return (
    <NodeDefaultsContext.Provider value={value}>{children}</NodeDefaultsContext.Provider>
  );
}

export function useNodeDefaults(): NodeDefaultsContextValue {
  const ctx = useContext(NodeDefaultsContext);
  if (!ctx) {
    // Outside a provider (e.g. landing page) — return a no-op shape so callers
    // don't crash. They should only depend on this inside WorkspaceEditor.
    return {
      getMergedOverrides: () => ({}),
      refresh: async () => {},
      global: EMPTY,
      workspace: EMPTY,
    };
  }
  return ctx;
}
