import type { Node, Edge } from "@xyflow/react";
import type { NodeOutputEnvelope } from "./types";
import { pluginRegistry } from "./pluginRegistry";
import { getOutputEnvelope } from "./nodeData";

/**
 * Extracts the string `value` from an upstream node, going through
 * `plugin.getOutput()` if defined and otherwise falling back to the
 * standardized `outputEnvelope` written by executors.
 */
export function getUpstreamNodeData(upstreamNode: Node): string | null {
  if (!upstreamNode || !upstreamNode.data) return null;

  const plugin = pluginRegistry.get(upstreamNode.type || "");
  if (plugin?.getOutput) {
    const envelope = plugin.getOutput(upstreamNode.data as Record<string, unknown>);
    if (envelope.value !== undefined && envelope.value !== null) return envelope.value;
  }

  const envelope = upstreamNode.data.outputEnvelope as NodeOutputEnvelope | undefined;
  if (envelope && envelope.value !== undefined && envelope.value !== null) {
    return envelope.value;
  }

  return null;
}

/**
 * Returns the full standard JSON envelope from an upstream node. If the node
 * has not yet produced one, returns an empty envelope flagged with
 * `metadata.generatedFallback: true` so downstream UI (e.g. ConnectionInspector)
 * can distinguish a real empty envelope from a "no output yet" placeholder.
 *
 * Reads through {@link getOutputEnvelope} so any malformed `outputEnvelope`
 * (e.g. missing `value`) degrades to the fallback rather than propagating
 * an invalid envelope downstream.
 */
export function getUpstreamNodeEnvelope(upstreamNode: Node): NodeOutputEnvelope {
  const fallback: NodeOutputEnvelope = { value: "", metadata: { generatedFallback: true } };

  if (!upstreamNode || !upstreamNode.data) {
    return fallback;
  }

  const plugin = pluginRegistry.get(upstreamNode.type || "");
  if (plugin?.getOutput) {
    return plugin.getOutput(upstreamNode.data as Record<string, unknown>);
  }

  const envelope = getOutputEnvelope(upstreamNode.data as Record<string, unknown>);
  return envelope ?? fallback;
}

export interface UpstreamFilterOptions {
  /** Drop upstream nodes outside the active run's visited set. Pass the
   * runner's `visited` Set to keep cross-component noise out. */
  visited?: Set<string>;
  /** Also follow bi-directional edges in the reverse direction (where this
   * node is the source). Used by LLM/Chat which exchange data both ways. */
  includeBiDirectional?: boolean;
  /** Drop edges where either endpoint uses the dedicated "storage" handle.
   * Used when the executor wants logical-flow upstream, not storage. */
  excludeStorageHandles?: boolean;
}

/**
 * Resolve the upstream nodes of `nodeId` under a few common filters. Used by
 * executors to find their input sources without each one re-implementing the
 * `edges.filter(...)` + `nodes.filter(...)` + `visited?.has(...)` chain.
 */
export function getUpstreamNodes(
  nodeId: string,
  edges: Edge[],
  nodes: Node[],
  opts: UpstreamFilterOptions = {}
): Node[] {
  const { visited, includeBiDirectional = false, excludeStorageHandles = false } = opts;

  const upstreamEdges = edges.filter((e) => {
    if (excludeStorageHandles && (e.sourceHandle === "storage" || e.targetHandle === "storage")) {
      return false;
    }
    if (e.target === nodeId) return true;
    if (
      includeBiDirectional &&
      e.source === nodeId &&
      e.data?.edgeType === "bi-directional"
    ) {
      return true;
    }
    return false;
  });

  const ids = new Set<string>();
  for (const e of upstreamEdges) {
    if (e.source !== nodeId) ids.add(e.source);
    if (includeBiDirectional && e.target !== nodeId) ids.add(e.target);
  }

  let result = nodes.filter((n) => ids.has(n.id));
  if (visited) {
    result = result.filter((n) => visited.has(n.id));
  }
  return result;
}

export interface EdgePermissions {
  hasRead: boolean;
  hasWrite: boolean;
}

/**
 * Parse a storage edge's `edgeType` into discrete read/write permissions.
 * `defaultType` lets the caller pick the fallback when the edge has no
 * explicit `edgeType` set — Chat defaults to "read-write" so a fresh
 * connection is fully bidirectional, while the engine's storage-sync path
 * defaults to "write-only" so a passive storage connection just receives.
 */
export function resolveEdgePermissions(
  edge: Edge | undefined,
  defaultType: "read-only" | "write-only" | "read-write" = "read-write"
): EdgePermissions {
  const edgeType = (edge?.data?.edgeType as string) || defaultType;
  return {
    hasRead: edgeType === "read-only" || edgeType === "read-write",
    hasWrite: edgeType === "write-only" || edgeType === "read-write",
  };
}
