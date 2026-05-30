import type { Edge } from "@xyflow/react";

/**
 * BFS that walks forward from `startNodeIds` along non-storage edges,
 * treating bi-directional edges as reverse-traversable. Returns the set
 * of node ids reachable downstream of the start set (not including the
 * start ids themselves).
 *
 * Used by the run loop to scope per-node status updates to nodes the
 * current run is actually responsible for.
 */
export function getReachableNodeIds(startNodeIds: string[], edges: Edge[]): Set<string> {
  const reachable = new Set<string>();
  const queue = [...startNodeIds];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    // Find outgoing edges from this node (ignoring storage edges)
    const outgoing = edges.filter((e) => {
      if (e.sourceHandle === "storage" || e.targetHandle === "storage") return false;
      return (
        e.source === currentId ||
        (e.target === currentId && e.data?.edgeType === "bi-directional")
      );
    });

    outgoing.forEach((e) => {
      const nextId = e.source === currentId ? e.target : e.source;
      if (!startNodeIds.includes(nextId)) {
        reachable.add(nextId);
        queue.push(nextId);
      }
    });
  }

  return reachable;
}

/**
 * BFS in the opposite direction: ancestors of `startNodeIds`. Used by the
 * run loop to (a) re-seed already-run upstream nodes on a retry and (b)
 * recognize a pause node reached via a loop-back as a return path rather
 * than a fresh forward halt.
 */
export function getAncestorNodeIds(startNodeIds: string[], edges: Edge[]): Set<string> {
  const ancestors = new Set<string>();
  const queue = [...startNodeIds];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    // Find incoming edges to this node (ignoring storage edges)
    const incoming = edges.filter((e) => {
      if (e.sourceHandle === "storage" || e.targetHandle === "storage") return false;
      return (
        e.target === currentId ||
        (e.source === currentId && e.data?.edgeType === "bi-directional")
      );
    });

    incoming.forEach((e) => {
      const prevId = e.target === currentId ? e.source : e.target;
      if (!startNodeIds.includes(prevId)) {
        ancestors.add(prevId);
        queue.push(prevId);
      }
    });
  }

  return ancestors;
}
