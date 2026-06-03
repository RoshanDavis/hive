// The Agent's persistent memory: read/write access to its Storage slot records,
// surfaced to the model as the `memory_save` / `memory_search` / `memory_list`
// tools (resolved in agentTools.ts, executed against this handler). The handler
// mutates a working records array in place; AgentExecutor persists it after the
// run (records are decoupled to disk on save). See docs/agent-node.md.

import type { JSONStorageRecord } from "@/nodes/types";
import type { NodeOutputEnvelope } from "./types";

/** Default # of entries returned by memory_search / memory_list, and the hard cap. */
const DEFAULT_RECALL = 10;
const MAX_RECALL = 50;
/** Per-entry character cap in a tool result, so a recall stays bounded. */
const ENTRY_MAX = 500;

/** Build a storage record (collision-free id + timestamps). Shared by the memory
 * tools and the agent's final-answer append so both produce the same shape. */
export function makeStorageRecord(opts: {
  content: string;
  source: string;
  envelope?: NodeOutputEnvelope;
}): JSONStorageRecord {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    source: opts.source,
    content: opts.content,
    ...(opts.envelope ? { envelope: opts.envelope } : {}),
    createdAt: new Date().toISOString(),
  };
}

/** Read/write access to an agent's memory (its Storage slot records), exposed to
 * the model as the memory_* tools. Each method returns the textual result the
 * model reads back. Mutates the backing records array in place. */
export interface MemoryHandler {
  save(content: string): string;
  search(query: string, limit?: number): string;
  list(limit?: number): string;
}

const clampLimit = (limit: number | undefined): number => {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_RECALL;
  return Math.max(1, Math.min(MAX_RECALL, Math.floor(limit)));
};

function formatRecord(r: JSONStorageRecord): string {
  const c = (r.content || "").replace(/\s+/g, " ").trim();
  const text = c.length > ENTRY_MAX ? `${c.slice(0, ENTRY_MAX)}…` : c;
  return `- [${r.timestamp}] ${text}`;
}

/**
 * Create a {@link MemoryHandler} over `records` (the agent's working copy of its
 * Storage slot). `save` appends a memory entry; `search` does a case-insensitive
 * substring match; `list` returns the most recent entries. Results are newest-first.
 */
export function createMemoryHandler(records: JSONStorageRecord[], source: string): MemoryHandler {
  return {
    save(content) {
      records.push(makeStorageRecord({ content, source: `${source} · memory` }));
      return "Saved to memory.";
    },
    search(query, limit) {
      const q = query.trim().toLowerCase();
      if (!q) return "Provide a non-empty query to search memory.";
      const hits = records.filter((r) => (r.content || "").toLowerCase().includes(q));
      if (hits.length === 0) return `No memories match "${query}".`;
      return hits.slice(-clampLimit(limit)).reverse().map(formatRecord).join("\n");
    },
    list(limit) {
      if (records.length === 0) return "Memory is empty.";
      return records.slice(-clampLimit(limit)).reverse().map(formatRecord).join("\n");
    },
  };
}
