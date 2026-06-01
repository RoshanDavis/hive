/**
 * Shared derivation of the Workflows-inspector row groups (Running / Waiting /
 * Errored) from a space's nodes + running-start-id map. Pure and side-effect
 * free so it can run per-render in the component AND per-space inside the
 * session's snapshot builder (cross-space workflow visibility) without the two
 * ever disagreeing on what counts as an active/waiting/errored workflow.
 */

import type { Node } from "@xyflow/react";
import { pluginRegistry } from "./pluginRegistry";

/** One running workflow, identified by its comma-joined start-node id key. */
export interface ActiveRunRow {
  startKey: string;
  startNodeIds: string[];
  label: string;
  icon: string;
}

/** One node surfaced as its own row because it's waiting on input or errored. */
export interface NodeRow {
  id: string;
  label: string;
  icon: string;
  error?: string;
}

export interface WorkflowRows {
  activeRuns: ActiveRunRow[];
  waitingNodes: NodeRow[];
  erroredNodes: NodeRow[];
  /** True if any node in this space carries status/statusRunId/error — drives
   * the "Clear all" affordance. */
  anyClearable: boolean;
}

/** Workflow activity for a single space, used to surface runs from spaces
 * other than the one currently being viewed. Spaces are organizational, so a
 * run started in space 1 stays visible from space 2. */
export interface SpaceWorkflowSummary {
  spaceId: string;
  spaceLabel: string;
  activeRuns: ActiveRunRow[];
  waitingNodes: NodeRow[];
  erroredNodes: NodeRow[];
}

export function labelFor(node: Node | undefined): string {
  if (!node) return "(deleted node)";
  const fromData = node.data?.label;
  if (typeof fromData === "string" && fromData.trim()) return fromData;
  const plugin = pluginRegistry.get(node.type || "");
  return plugin?.meta.label || node.type || node.id;
}

export function iconFor(node: Node | undefined): string {
  if (!node) return "❔";
  const plugin = pluginRegistry.get(node.type || "");
  return plugin?.meta.icon || "▣";
}

/** Derive the Running / Waiting / Errored row groups for one space. */
export function buildWorkflowRows(
  nodes: Node[],
  runningStartNodeIds: Map<string, number>
): WorkflowRows {
  const activeRuns: ActiveRunRow[] = [];
  for (const [startKey] of runningStartNodeIds) {
    const ids = startKey.split(",");
    const firstNode = nodes.find((n) => n.id === ids[0]);
    const label = ids
      .map((id) => labelFor(nodes.find((n) => n.id === id)))
      .join(" · ");
    activeRuns.push({
      startKey,
      startNodeIds: ids,
      label,
      icon: iconFor(firstNode),
    });
  }

  const waitingNodes: NodeRow[] = [];
  const erroredNodes: NodeRow[] = [];
  let anyClearable = false;
  for (const n of nodes) {
    const status = n.data?.status as string | undefined;
    if (status || n.data?.statusRunId || n.data?.error) anyClearable = true;
    if (status === "waiting") {
      waitingNodes.push({ id: n.id, label: labelFor(n), icon: iconFor(n) });
    } else if (status === "error") {
      erroredNodes.push({
        id: n.id,
        label: labelFor(n),
        icon: iconFor(n),
        error: typeof n.data?.error === "string" ? n.data.error : undefined,
      });
    }
  }
  return { activeRuns, waitingNodes, erroredNodes, anyClearable };
}
