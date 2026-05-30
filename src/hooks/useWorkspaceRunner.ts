import { useCallback } from "react";
import { useSyncExternalStore } from "react";
import { type RunnerSession } from "@/contexts/runnerSession";

/**
 * Thin view binding that exposes the session's runner API and the running-state
 * snapshot to a mounted `WorkspaceEditor`. The actual run loop lives in
 * `runnerSession.ts`, where it survives WorkspaceEditor unmount.
 */
export function useWorkspaceRunner(session: RunnerSession) {
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
  const getSnapshot = useCallback(() => session.getSnapshot(), [session]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const runningStartNodeIds = snapshot.runningStartNodeIds;
  const isRunning = runningStartNodeIds.size > 0;

  return {
    isRunning,
    runningStartNodeIds,
    executeWorkflow: session.executeWorkflow,
    handleChatSend: session.handleChatSend,
    retryWorkflow: session.retryWorkflow,
    cancelWorkflow: session.cancelWorkflow,
  };
}
