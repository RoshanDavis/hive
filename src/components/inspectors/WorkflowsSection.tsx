import { useMemo } from "react";
import type { Node } from "@xyflow/react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { getStatusColor } from "@/theme/colors";
import CollapsibleSection from "./CollapsibleSection";

interface WorkflowsSectionProps {
  /** All nodes in the active space — used to resolve labels for active-run
   * start nodes and to surface errored/waiting nodes as their own rows. */
  nodes: Node[];
  /** Map of comma-joined start-node-id key → count. The session's snapshot
   * exposes this; the run loop populates it on `runWorkflow` start and
   * decrements on cleanup. */
  runningStartNodeIds: Map<string, number>;
  onRetryWorkflow: (nodeId: string) => void;
  onCancelWorkflow: (nodeId?: string) => void;
  onClearAllStatuses: () => void;
}

interface ActiveRunRow {
  startKey: string;
  startNodeIds: string[];
  label: string;
  icon: string;
}

interface NodeRow {
  id: string;
  label: string;
  icon: string;
  error?: string;
}

function labelFor(node: Node | undefined): string {
  if (!node) return "(deleted node)";
  const fromData = node.data?.label;
  if (typeof fromData === "string" && fromData.trim()) return fromData;
  const plugin = pluginRegistry.get(node.type || "");
  return plugin?.meta.label || node.type || node.id;
}

function iconFor(node: Node | undefined): string {
  if (!node) return "❔";
  const plugin = pluginRegistry.get(node.type || "");
  return plugin?.meta.icon || "▣";
}

export default function WorkflowsSection({
  nodes,
  runningStartNodeIds,
  onRetryWorkflow,
  onCancelWorkflow,
  onClearAllStatuses,
}: WorkflowsSectionProps) {
  // Build the three row groups from the latest nodes snapshot. All cheap;
  // re-derive on every render since the parent already re-renders on the
  // session's snapshot bumps (runningStartNodeIds + nodes both come from it).
  const { activeRuns, waitingNodes, erroredNodes, anyClearable } = useMemo(() => {
    const active: ActiveRunRow[] = [];
    for (const [startKey] of runningStartNodeIds) {
      const ids = startKey.split(",");
      const firstNode = nodes.find((n) => n.id === ids[0]);
      const label = ids
        .map((id) => labelFor(nodes.find((n) => n.id === id)))
        .join(" · ");
      active.push({
        startKey,
        startNodeIds: ids,
        label,
        icon: iconFor(firstNode),
      });
    }

    const waiting: NodeRow[] = [];
    const errored: NodeRow[] = [];
    let anyStatus = false;
    for (const n of nodes) {
      const status = n.data?.status as string | undefined;
      if (status || n.data?.statusRunId || n.data?.error) anyStatus = true;
      if (status === "waiting") {
        waiting.push({ id: n.id, label: labelFor(n), icon: iconFor(n) });
      } else if (status === "error") {
        errored.push({
          id: n.id,
          label: labelFor(n),
          icon: iconFor(n),
          error: typeof n.data?.error === "string" ? n.data.error : undefined,
        });
      }
    }
    return {
      activeRuns: active,
      waitingNodes: waiting,
      erroredNodes: errored,
      anyClearable: anyStatus,
    };
  }, [nodes, runningStartNodeIds]);

  const totalCount = activeRuns.length + waitingNodes.length + erroredNodes.length;

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
        {activeRuns.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-widest font-bold text-text-muted mt-1">
              Running
            </div>
            {activeRuns.map((run) => (
              <div
                key={run.startKey}
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
                <button
                  type="button"
                  onClick={() => onCancelWorkflow(run.startNodeIds[0])}
                  title="Stop this workflow"
                  className="text-[11px] font-semibold text-red-200 hover:text-white bg-red-500/15 hover:bg-red-500/30 border border-red-500/40 hover:border-red-500/60 rounded-md px-2 py-0.5 cursor-pointer transition-colors flex items-center gap-1 shrink-0"
                >
                  <span>⏹</span>
                  <span>Stop</span>
                </button>
              </div>
            ))}
          </>
        )}

        {waitingNodes.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-widest font-bold text-text-muted mt-1">
              Waiting
            </div>
            {waitingNodes.map((row) => (
              <div
                key={row.id}
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
                <span className="text-[10px] uppercase tracking-wider text-text-muted shrink-0">
                  Awaiting input
                </span>
                <button
                  type="button"
                  onClick={() => onCancelWorkflow(row.id)}
                  title="Abandon this paused workflow"
                  className="text-[11px] font-semibold text-text-muted hover:text-text-main bg-card hover:bg-card-hover border border-border-subtle hover:border-border-subtle rounded-md px-2 py-0.5 cursor-pointer transition-colors shrink-0"
                >
                  Cancel
                </button>
              </div>
            ))}
          </>
        )}

        {erroredNodes.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-widest font-bold text-text-muted mt-1">
              Errored
            </div>
            {erroredNodes.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-1.5 bg-red-500/5 border border-red-500/30 rounded-md px-2.5 py-2"
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
                  <button
                    type="button"
                    onClick={() => onRetryWorkflow(row.id)}
                    title="Retry the workflow from this node"
                    className="text-[11px] font-semibold text-red-200 hover:text-white bg-red-500/15 hover:bg-red-500/30 border border-red-500/40 hover:border-red-500/60 rounded-md px-2 py-0.5 cursor-pointer transition-colors flex items-center gap-1 shrink-0"
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
            className="mt-2 flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-text-secondary hover:text-text-main bg-card hover:bg-card-hover border border-border-subtle hover:border-accent-dim rounded-md px-2.5 py-1.5 cursor-pointer transition-colors"
          >
            <span>🧹</span>
            <span>Clear all</span>
          </button>
        )}
      </div>
    </CollapsibleSection>
  );
}
