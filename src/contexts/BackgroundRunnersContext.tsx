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
  /** Whether the given workspace's loaded space has at least one errored node. */
  hasErrorNodes: (workspacePath: string) => boolean;
  /**
   * Subscribe to changes in run state OR error state for the given workspace.
   * Listeners fire on active-run transitions and on error-count transitions,
   * so a single subscription is enough for both the green and red dots.
   */
  subscribe: (workspacePath: string, listener: () => void) => () => void;
  /**
   * Return the existing session for a workspace, or create+init one. The
   * `showToast` arg becomes the active toast sink for as long as the editor
   * is mounted. Callers must pair this with `detachSession(path)` on unmount.
   */
  getOrCreateSession: (workspacePath: string, showToast: ShowToastFunc) => RunnerSession;
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
    return sessionsRef.current.get(workspacePath)?.hasErrorNodes() ?? false;
  }, []);

  const getOrCreateSession = useCallback(
    (workspacePath: string, showToast: ShowToastFunc): RunnerSession => {
      let session = sessionsRef.current.get(workspacePath);
      if (!session) {
        // Resolve the workspace's backgroundExecution flag from the registry.
        // This is fire-and-forget; the session starts true and we correct it
        // when the registry read returns. The `setBackgroundExecution` setter
        // notifies subscribers.
        let initialBackground = true;
        void api
          .getWorkspaces()
          .then((list) => {
            const found = list.find((w) => w.path === workspacePath);
            if (found && found.background_execution !== initialBackground) {
              session?.setBackgroundExecution(found.background_execution);
            }
          })
          .catch(() => {
            // Non-critical — toggle just falls back to default-true.
          });

        session = createRunnerSession({
          workspacePath,
          backgroundExecution: initialBackground,
          onActiveRunsChange: () => notifyActiveRuns(workspacePath),
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
    [notifyActiveRuns, notifyLive]
  );

  const detachSession = useCallback((workspacePath: string) => {
    const session = sessionsRef.current.get(workspacePath);
    if (!session) return;
    const disposed = session.detach();
    if (disposed) {
      sessionsRef.current.delete(workspacePath);
      notifyActiveRuns(workspacePath);
      notifyLive();
    }
  }, [notifyActiveRuns, notifyLive]);

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
      subscribe,
      getOrCreateSession,
      setBackgroundExecution,
      detachSession,
      flushAllSessions,
      getLiveWorkspacePaths,
      subscribeLive,
    }),
    [hasActiveRuns, hasErrorNodes, subscribe, getOrCreateSession, setBackgroundExecution, detachSession, flushAllSessions, getLiveWorkspacePaths, subscribeLive]
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
 * Convenience hook: re-renders when any node in the workspace's loaded space
 * transitions in or out of `status: "error"`. Sibling of `useHasActiveRuns`.
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
