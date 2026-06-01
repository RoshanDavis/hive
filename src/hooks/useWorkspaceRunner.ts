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
  const otherSpaceWorkflows = snapshot.otherSpaceWorkflows;

  // Note: we deliberately do NOT expose a workspace-wide `isRunning` flag.
  // Per-node UI (Trigger Run button, Retry/Stop, Script "Run from here")
  // must derive its own running state by checking whether the node's id
  // appears in any active `startKey` in `runningStartNodeIds`. Concurrent
  // workflows are independent; one running should never disable another's
  // controls. See `InspectorPanel.isRunning` for the per-selected derivation.
  return {
    runningStartNodeIds,
    // Cross-space activity so the Workflows inspector can list (and control)
    // runs that live in sibling spaces — spaces are organizational only.
    otherSpaceWorkflows,
    executeWorkflow: session.executeWorkflow,
    handleChatSend: session.handleChatSend,
    retryWorkflow: session.retryWorkflow,
    retryWorkflowInSpace: session.retryWorkflowInSpace,
    cancelWorkflow: session.cancelWorkflow,
    cancelWorkflowInSpace: session.cancelWorkflowInSpace,
    clearAllStatuses: session.clearAllStatuses,
  };
}
