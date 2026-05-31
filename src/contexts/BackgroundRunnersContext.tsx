import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { api } from "@/services/api";
import {
  createRunnerSession,
  type RunnerSession,
} from "@/contexts/runnerSession";
import { type ShowToastFunc } from "@/types/workspace";

/**
 * App-level registry of per-workspace RunnerSessions. A session is created
 * lazily on `getOrCreateSession()` (called from WorkspaceEditor on first
 * mount), owns the canonical canvas + runner state for its workspace, and
 * survives WorkspaceEditor mount/unmount as long as it's retained.
 *
 * Retention policy (Step 6): on the last detach, a session is retained iff
 * `backgroundExecution === true` and there's at least one active run.
 * Otherwise it flushes its final auto-save and is disposed.
 */

interface BackgroundRunnersContextValue {
  /** Whether the given workspace currently has at least one active run. */
  hasActiveRuns: (workspacePath: string) => boolean;
  /**
   * Whether the given workspace has any errored node — across **every** space,
   * not just the one currently loaded. Unions the in-memory session state
   * (fresh, but only sees the loaded space) with the per-space rollup on disk
   * (covers every space, but lags an in-flight transition by one auto-save).
   */
  hasErrorNodes: (workspacePath: string) => boolean;
  /**
   * Whether the given workspace has any node paused on user input. Same
   * in-memory ∪ on-disk union as `hasErrorNodes`. Used by the Dashboard's
   * yellow dot.
   */
  hasWaitingNodes: (workspacePath: string) => boolean;
  /**
   * Subscribe to changes in run state, error rollup, or waiting rollup for
   * the given workspace. A single subscription powers green/red/yellow on
   * the Dashboard card.
   */
  subscribe: (workspacePath: string, listener: () => void) => () => void;
  /**
   * Refresh the on-disk per-space rollups for the given workspace paths
   * (single batched Tauri call). The Dashboard calls this on mount and after
   * the workspace list changes; the provider also auto-refreshes after a
   * session's save fires so cross-space state stays current.
   */
  refreshDiskRollups: (workspacePaths: string[]) => Promise<void>;
  /**
   * Return the existing session for a workspace, or create+init one. The
   * `showToast` arg becomes the active toast sink for as long as the editor
   * is mounted. `initialBackgroundExecution` is the workspace registry's
   * persisted flag at the moment the editor opened — used only when a new
   * session is created here (existing sessions ignore it; toggle changes go
   * through `setBackgroundExecution`). Callers must pair this with
   * `detachSession(path)` on unmount.
   */
  getOrCreateSession: (
    workspacePath: string,
    showToast: ShowToastFunc,
    initialBackgroundExecution: boolean
  ) => RunnerSession;
  /** Mirror the on-disk toggle so the session knows its own retention policy. */
  setBackgroundExecution: (workspacePath: string, enabled: boolean) => void;
  /** Decrement the session's mount ref-count; may dispose if last detacher. */
  detachSession: (workspacePath: string) => void;
  /** Flush every retained session's pending save (used on app close). */
  flushAllSessions: () => Promise<void>;
  /**
   * Paths of every currently-live workspace session (foreground + retained
   * background). Consumed by `CustomNodesProvider` so script/preset nodes
   * stay registered for any workspace whose run loop is still active.
   */
  getLiveWorkspacePaths: () => string[];
  /** Subscribe to changes in the live-workspace set. */
  subscribeLive: (listener: () => void) => () => void;
}

const BackgroundRunnersContext = createContext<BackgroundRunnersContextValue | null>(null);

interface ProviderProps {
  children: ReactNode;
}

export function BackgroundRunnersProvider({ children }: ProviderProps) {
  // Sessions live in a ref (mutating the Map mustn't re-render the whole tree).
  const sessionsRef = useRef<Map<string, RunnerSession>>(new Map());
  // Per-workspace active-run listener sets. Notified when a session's run state
  // changes; consumed by the Dashboard card indicator.
  const listenersRef = useRef<Map<string, Set<() => void>>>(new Map());
  // Live-set listeners: notified when a workspace session is created or
  // disposed. Consumed by CustomNodesProvider for multi-workspace registration.
  const liveListenersRef = useRef<Set<() => void>>(new Set());
  // On-disk per-space rollup cache, keyed by workspace path. Lets the
  // Dashboard's dot reflect errors/pauses in spaces the workspace's session
  // hasn't loaded — or that have no live session at all.
  const diskRollupsRef = useRef<Map<string, { hasError: boolean; hasWaiting: boolean }>>(new Map());

  const notifyLive = useCallback(() => {
    for (const listener of liveListenersRef.current) listener();
  }, []);

  const getLiveWorkspacePaths = useCallback(() => {
    return Array.from(sessionsRef.current.keys());
  }, []);

  const subscribeLive = useCallback((listener: () => void) => {
    liveListenersRef.current.add(listener);
    return () => {
      liveListenersRef.current.delete(listener);
    };
  }, []);

  const notifyActiveRuns = useCallback((workspacePath: string) => {
    const set = listenersRef.current.get(workspacePath);
    if (!set) return;
    for (const listener of set) listener();
  }, []);

  const subscribe = useCallback((workspacePath: string, listener: () => void) => {
    let set = listenersRef.current.get(workspacePath);
    if (!set) {
      set = new Set();
      listenersRef.current.set(workspacePath, set);
    }
    set.add(listener);
    return () => {
      const current = listenersRef.current.get(workspacePath);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) listenersRef.current.delete(workspacePath);
    };
  }, []);

  const hasActiveRuns = useCallback((workspacePath: string) => {
    return sessionsRef.current.get(workspacePath)?.hasActiveRuns() ?? false;
  }, []);

  const hasErrorNodes = useCallback((workspacePath: string) => {
    const inMemory = sessionsRef.current.get(workspacePath)?.hasErrorNodes() ?? false;
    const onDisk = diskRollupsRef.current.get(workspacePath)?.hasError ?? false;
    return inMemory || onDisk;
  }, []);

  const hasWaitingNodes = useCallback((workspacePath: string) => {
    const inMemory = sessionsRef.current.get(workspacePath)?.hasWaitingNodes() ?? false;
    const onDisk = diskRollupsRef.current.get(workspacePath)?.hasWaiting ?? false;
    return inMemory || onDisk;
  }, []);

  const refreshDiskRollups = useCallback(async (workspacePaths: string[]) => {
    if (workspacePaths.length === 0) return;
    let rollups: Awaited<ReturnType<typeof api.getWorkspaceStatusRollups>>;
    try {
      rollups = await api.getWorkspaceStatusRollups(workspacePaths);
    } catch {
      // Best-effort: leave the cache as-is on RPC failure so the Dashboard
      // keeps showing whatever it last knew.
      return;
    }
    const changed: string[] = [];
    for (const r of rollups) {
      const prev = diskRollupsRef.current.get(r.path);
      if (!prev || prev.hasError !== r.has_error || prev.hasWaiting !== r.has_waiting) {
        diskRollupsRef.current.set(r.path, { hasError: r.has_error, hasWaiting: r.has_waiting });
        changed.push(r.path);
      }
    }
    for (const path of changed) notifyActiveRuns(path);
  }, [notifyActiveRuns]);

  const getOrCreateSession = useCallback(
    (
      workspacePath: string,
      showToast: ShowToastFunc,
      initialBackgroundExecution: boolean
    ): RunnerSession => {
      let session = sessionsRef.current.get(workspacePath);
      if (!session) {
        // Use the caller-supplied registry value as the initial flag. The
        // caller (WorkspaceEditor) reads it from the Workspace registry entry
        // it was opened with, so there's no async window where the session
        // disagrees with disk on retention policy.
        session = createRunnerSession({
          workspacePath,
          backgroundExecution: initialBackgroundExecution,
          onActiveRunsChange: () => notifyActiveRuns(workspacePath),
          onAfterSave: () => {
            // Auto-save just hit disk → the per-space rollup may have flipped.
            // Re-pull it so cross-space dots (other spaces in this workspace)
            // and the Dashboard's idle-but-errored case stay accurate.
            void refreshDiskRollups([workspacePath]);
          },
          onSelfDispose: () => {
            sessionsRef.current.delete(workspacePath);
            notifyActiveRuns(workspacePath);
            notifyLive();
          },
        });
        sessionsRef.current.set(workspacePath, session);
        // Fire the first load. attach() is called below regardless of
        // whether init has finished.
        void session.init();
        notifyLive();
      }
      session.attach(showToast);
      return session;
    },
    [notifyActiveRuns, notifyLive, refreshDiskRollups]
  );

  const detachSession = useCallback((workspacePath: string) => {
    const session = sessionsRef.current.get(workspacePath);
    if (!session) return;
    // detach() now always returns false: when disposal is scheduled, the
    // session keeps itself registered until its async flushSave+dispose
    // chain completes, at which point `onSelfDispose` (set on creation)
    // does the removal + notification. This prevents a duplicate session
    // from being created on a fast re-mount during in-flight save.
    session.detach();
  }, []);

  const setBackgroundExecution = useCallback(
    (workspacePath: string, enabled: boolean) => {
      const session = sessionsRef.current.get(workspacePath);
      if (!session) return;
      session.setBackgroundExecution(enabled);
      // Toggling off doesn't cancel a current run — it just changes the
      // retention decision the next time the editor detaches. A retained
      // session with no runs and no editor will be disposed by the session
      // itself via its post-run cleanup hook.
    },
    []
  );

  const flushAllSessions = useCallback(async () => {
    const all = Array.from(sessionsRef.current.values());
    await Promise.all(all.map((s) => s.flushSave()));
  }, []);

  // Best-effort flush on app/tab close. Tauri runs in a webview that fires
  // `beforeunload`, so this gives retained sessions a chance to persist
  // their last in-flight write. Anything left behind is recovered by the
  // `load_space` status-sweep on next open.
  useEffect(() => {
    const handler = () => {
      void flushAllSessions();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [flushAllSessions]);

  const value = useMemo<BackgroundRunnersContextValue>(
    () => ({
      hasActiveRuns,
      hasErrorNodes,
      hasWaitingNodes,
      subscribe,
      refreshDiskRollups,
      getOrCreateSession,
      setBackgroundExecution,
      detachSession,
      flushAllSessions,
      getLiveWorkspacePaths,
      subscribeLive,
    }),
    [hasActiveRuns, hasErrorNodes, hasWaitingNodes, subscribe, refreshDiskRollups, getOrCreateSession, setBackgroundExecution, detachSession, flushAllSessions, getLiveWorkspacePaths, subscribeLive]
  );

  return (
    <BackgroundRunnersContext.Provider value={value}>
      {children}
    </BackgroundRunnersContext.Provider>
  );
}

export function useBackgroundRunners(): BackgroundRunnersContextValue {
  const ctx = useContext(BackgroundRunnersContext);
  if (!ctx) {
    throw new Error("useBackgroundRunners must be used within a BackgroundRunnersProvider");
  }
  return ctx;
}

/**
 * Convenience hook: re-renders the caller whenever `hasActiveRuns(path)`
 * changes for the given workspace path.
 */
export function useHasActiveRuns(workspacePath: string): boolean {
  const ctx = useContext(BackgroundRunnersContext);
  // Stable no-op subscribe + always-false snapshot when used outside provider.
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!ctx) return () => {};
      return ctx.subscribe(workspacePath, listener);
    },
    [ctx, workspacePath]
  );
  const getSnapshot = useCallback(() => {
    return ctx?.hasActiveRuns(workspacePath) ?? false;
  }, [ctx, workspacePath]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * Convenience hook: re-renders when the workspace's union of in-memory
 * loaded-space errors and on-disk per-space rollup transitions. Sibling of
 * `useHasActiveRuns`.
 */
export function useHasErrorNodes(workspacePath: string): boolean {
  const ctx = useContext(BackgroundRunnersContext);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!ctx) return () => {};
      return ctx.subscribe(workspacePath, listener);
    },
    [ctx, workspacePath]
  );
  const getSnapshot = useCallback(() => {
    return ctx?.hasErrorNodes(workspacePath) ?? false;
  }, [ctx, workspacePath]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * Convenience hook: re-renders when the workspace has a node paused on user
 * input — across every space, not just the one loaded. Drives the yellow dot.
 */
export function useHasWaitingNodes(workspacePath: string): boolean {
  const ctx = useContext(BackgroundRunnersContext);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!ctx) return () => {};
      return ctx.subscribe(workspacePath, listener);
    },
    [ctx, workspacePath]
  );
  const getSnapshot = useCallback(() => {
    return ctx?.hasWaitingNodes(workspacePath) ?? false;
  }, [ctx, workspacePath]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
