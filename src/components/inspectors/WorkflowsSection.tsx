import { useMemo } from "react";
import type { Node } from "@xyflow/react";
import { getStatusColor } from "@/theme/colors";
import {
  buildWorkflowRows,
  type ActiveRunRow,
  type NodeRow,
  type SpaceWorkflowSummary,
} from "@/engine/workflowRows";
import CollapsibleSection from "./CollapsibleSection";

interface WorkflowsSectionProps {
  /** All nodes in the active space — used to resolve labels for active-run
   * start nodes and to surface errored/waiting nodes as their own rows. */
  nodes: Node[];
  /** Map of comma-joined start-node-id key → count for the ACTIVE space. */
  runningStartNodeIds: Map<string, number>;
  /** The active space id — every active-space row's controls route here. */
  activeSpaceId: string;
  /** Running/waiting/errored rows for sibling spaces with activity. Spaces are
   * organizational, so these render alongside the active space's runs with a
   * space badge, and their controls route to their own space. */
  otherSpaceWorkflows: SpaceWorkflowSummary[];
  onRetryWorkflowInSpace: (spaceId: string, nodeId: string) => void;
  onCancelWorkflowInSpace: (spaceId: string, nodeId?: string) => void;
  onClearAllStatuses: () => void;
}

/** A row tagged with the space it belongs to. `spaceLabel` is only set for
 * sibling spaces (the active space's rows render without a badge). */
type RunItem = ActiveRunRow & { spaceId: string; spaceLabel?: string };
type WaitItem = NodeRow & { spaceId: string; spaceLabel?: string };
type ErrItem = NodeRow & { spaceId: string; spaceLabel?: string };

/** Small chip showing which sibling space a row lives in. */
function SpaceBadge({ label }: { label: string }) {
  return (
    <span
      className="text-[9px] uppercase tracking-wider font-bold text-text-muted bg-card border border-border-subtle rounded px-1 py-0.5 shrink-0 leading-none"
      title={`Running in space ${label}`}
    >
      ⌗ {label}
    </span>
  );
}

export default function WorkflowsSection({
  nodes,
  runningStartNodeIds,
  activeSpaceId,
  otherSpaceWorkflows,
  onRetryWorkflowInSpace,
  onCancelWorkflowInSpace,
  onClearAllStatuses,
}: WorkflowsSectionProps) {
  // Build the three row groups by unioning the active space's rows (no badge)
  // with every sibling space's rows (badged). All cheap; re-derive on every
  // render since the parent already re-renders on the session's snapshot
  // bumps (which now fire for background-space activity too).
  const { runningRows, waitingRows, erroredRows, anyClearable } = useMemo(() => {
    const active = buildWorkflowRows(nodes, runningStartNodeIds);

    const running: RunItem[] = [
      ...active.activeRuns.map((r) => ({ ...r, spaceId: activeSpaceId })),
      ...otherSpaceWorkflows.flatMap((s) =>
        s.activeRuns.map((r) => ({ ...r, spaceId: s.spaceId, spaceLabel: s.spaceLabel }))
      ),
    ];
    const waiting: WaitItem[] = [
      ...active.waitingNodes.map((r) => ({ ...r, spaceId: activeSpaceId })),
      ...otherSpaceWorkflows.flatMap((s) =>
        s.waitingNodes.map((r) => ({ ...r, spaceId: s.spaceId, spaceLabel: s.spaceLabel }))
      ),
    ];
    const errored: ErrItem[] = [
      ...active.erroredNodes.map((r) => ({ ...r, spaceId: activeSpaceId })),
      ...otherSpaceWorkflows.flatMap((s) =>
        s.erroredNodes.map((r) => ({ ...r, spaceId: s.spaceId, spaceLabel: s.spaceLabel }))
      ),
    ];

    return {
      runningRows: running,
      waitingRows: waiting,
      erroredRows: errored,
      // "Clear all" stays scoped to the active space (it's a reset for the
      // canvas you're looking at); sibling-space rows are controlled
      // individually via their own Stop/Retry/Cancel.
      anyClearable: active.anyClearable,
    };
  }, [nodes, runningStartNodeIds, activeSpaceId, otherSpaceWorkflows]);

  const totalCount = runningRows.length + waitingRows.length + erroredRows.length;

  return (
    <CollapsibleSection
      title="Workflows"
      icon="⚡"
      defaultOpen={totalCount > 0}
      badge={totalCount > 0 ? totalCount : undefined}
    >
      {totalCount === 0 && !anyClearable && (
        <div className="text-[11px] text-text-muted py-3 text-center select-none">
          No active workflows.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {runningRows.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-widest font-bold text-text-muted mt-1">
              Running
            </div>
            {runningRows.map((run) => (
              <div
                key={`${run.spaceId}:${run.startKey}`}
                className="flex items-center gap-2 bg-card/60 border border-border-subtle rounded-md px-2.5 py-2"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
                  style={{
                    backgroundColor: getStatusColor("executing"),
                    boxShadow: `0 0 4px ${getStatusColor("executing")}`,
                  }}
                />
                <span className="text-base leading-none shrink-0" aria-hidden>
                  {run.icon}
                </span>
                <span
                  className="text-xs text-text-main flex-1 truncate"
                  title={run.label}
                >
                  {run.label}
                </span>
                {run.spaceLabel && <SpaceBadge label={run.spaceLabel} />}
                <button
                  type="button"
                  onClick={() => onCancelWorkflowInSpace(run.spaceId, run.startNodeIds[0])}
                  title="Stop this workflow"
                  className="text-[11px] font-semibold text-danger hover:text-danger-hover bg-danger/15 hover:bg-danger/30 border border-danger/40 hover:border-danger/60 rounded-md px-2 py-0.5 cursor-pointer transition-colors flex items-center gap-1 shrink-0"
                >
                  <span>⏹</span>
                  <span>Stop</span>
                </button>
              </div>
            ))}
          </>
        )}

        {waitingRows.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-widest font-bold text-text-muted mt-1">
              Waiting
            </div>
            {waitingRows.map((row) => (
              <div
                key={`${row.spaceId}:${row.id}`}
                className="flex items-center gap-2 bg-card/60 border border-border-subtle rounded-md px-2.5 py-2"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: getStatusColor("waiting"),
                    boxShadow: `0 0 4px ${getStatusColor("waiting")}`,
                  }}
                />
                <span className="text-base leading-none shrink-0" aria-hidden>
                  {row.icon}
                </span>
                <span className="text-xs text-text-main flex-1 truncate" title={row.label}>
                  {row.label}
                </span>
                {row.spaceLabel ? (
                  <SpaceBadge label={row.spaceLabel} />
                ) : (
                  <span className="text-[10px] uppercase tracking-wider text-text-muted shrink-0">
                    Awaiting input
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onCancelWorkflowInSpace(row.spaceId, row.id)}
                  title="Abandon this paused workflow"
                  className="text-[11px] font-semibold text-text-muted hover:text-text-main bg-card hover:bg-card-hover border border-border-subtle hover:border-border-subtle rounded-md px-2 py-0.5 cursor-pointer transition-colors shrink-0"
                >
                  Cancel
                </button>
              </div>
            ))}
          </>
        )}

        {erroredRows.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-widest font-bold text-text-muted mt-1">
              Errored
            </div>
            {erroredRows.map((row) => (
              <div
                key={`${row.spaceId}:${row.id}`}
                className="flex flex-col gap-1.5 bg-danger/5 border border-danger/30 rounded-md px-2.5 py-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: getStatusColor("error"),
                      boxShadow: `0 0 4px ${getStatusColor("error")}`,
                    }}
                  />
                  <span className="text-base leading-none shrink-0" aria-hidden>
                    {row.icon}
                  </span>
                  <span className="text-xs text-text-main flex-1 truncate" title={row.label}>
                    {row.label}
                  </span>
                  {row.spaceLabel && <SpaceBadge label={row.spaceLabel} />}
                  <button
                    type="button"
                    onClick={() => onRetryWorkflowInSpace(row.spaceId, row.id)}
                    title="Retry the workflow from this node"
                    className="text-[11px] font-semibold text-danger hover:text-danger-hover bg-danger/15 hover:bg-danger/30 border border-danger/40 hover:border-danger/60 rounded-md px-2 py-0.5 cursor-pointer transition-colors flex items-center gap-1 shrink-0"
                  >
                    <span>🔄</span>
                    <span>Retry</span>
                  </button>
                </div>
                {row.error && (
                  <p
                    className="text-[10px] text-text-secondary leading-relaxed whitespace-pre-wrap break-words m-0 pl-[18px]"
                    title={row.error}
                  >
                    {row.error.length > 140 ? `${row.error.slice(0, 140)}…` : row.error}
                  </p>
                )}
              </div>
            ))}
          </>
        )}

        {anyClearable && (
          <button
            type="button"
            onClick={onClearAllStatuses}
            title="End every active workflow and clear all node status borders in one action. Use to fully reset the workspace after a force-kill, a stuck retry, or anything else that left things in flight."
            className="mt-2 flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-text-secondary hover:text-text-main bg-card hover:bg-card-hover border border-border-subtle hover:border-border-card rounded-md px-2.5 py-1.5 cursor-pointer transition-colors"
          >
            <span>🧹</span>
            <span>Clear all</span>
          </button>
        )}
      </div>
    </CollapsibleSection>
  );
}
