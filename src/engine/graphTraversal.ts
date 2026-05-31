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
 * Bidirectional BFS that returns the full connected component of `nodeId`
 * — every node reachable from it by walking non-storage edges in either
 * direction, regardless of edge type. This is the natural definition of a
 * "workflow" for UI purposes: two flows that share no edge are separate
 * components, and a Stop click on one must not reach the other.
 *
 * Storage edges are excluded so that storage nodes shared between flows
 * don't fuse them into one component. The returned set always contains
 * `nodeId` itself (so an orphan node is its own component).
 */
export function getConnectedComponent(nodeId: string, edges: Edge[]): Set<string> {
  const component = new Set<string>([nodeId]);
  const queue: string[] = [nodeId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const e of edges) {
      if (e.sourceHandle === "storage" || e.targetHandle === "storage") continue;
      let otherId: string | null = null;
      if (e.source === currentId) otherId = e.target;
      else if (e.target === currentId) otherId = e.source;
      if (otherId && !component.has(otherId)) {
        component.add(otherId);
        queue.push(otherId);
      }
    }
  }
  return component;
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
