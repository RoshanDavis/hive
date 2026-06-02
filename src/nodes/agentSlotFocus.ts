import type { AgentSlotKind } from "./types";

// Tiny bridge so clicking a slot box on an Agent node (canvas) scrolls the
// matching section into view in the Agent inspector (right panel). Kept in
// `nodes/` so the inspector can depend on it without the node depending on the
// inspector. If the inspector isn't mounted yet (first click also selects the
// node), the request is parked as `pending` and consumed on mount.

type Listener = (slot: AgentSlotKind) => void;

let pending: { agentId: string; slot: AgentSlotKind } | null = null;
const listeners = new Map<string, Set<Listener>>();

export const agentSlotFocus = {
  /** Canvas slot click. Delivers live if the inspector is mounted, else parks it. */
  request(agentId: string, slot: AgentSlotKind): void {
    const set = listeners.get(agentId);
    if (set && set.size > 0) {
      set.forEach((cb) => cb(slot));
    } else {
      pending = { agentId, slot };
    }
  },

  /** Inspector reads (and clears) any focus parked for it before it mounted. */
  consumePending(agentId: string): AgentSlotKind | null {
    if (pending && pending.agentId === agentId) {
      const slot = pending.slot;
      pending = null;
      return slot;
    }
    return null;
  },

  /** Inspector subscribes while mounted; returns an unsubscribe. */
  subscribe(agentId: string, cb: Listener): () => void {
    let set = listeners.get(agentId);
    if (!set) {
      set = new Set();
      listeners.set(agentId, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
      if (set!.size === 0) listeners.delete(agentId);
    };
  },
};
