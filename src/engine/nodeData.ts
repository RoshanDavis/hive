import type { Edge, Node } from "@xyflow/react";
import type { ChatMessage, JSONStorageRecord } from "@/nodes/types";
import type { NodeOutputEnvelope } from "./types";

/**
 * Typed accessors for node data that lives untyped on React Flow's
 * `node.data` (a `Record<string, unknown>`). Centralizing these removes the
 * scattered `as any[]` / `as NodeOutputEnvelope` casts and gives a single,
 * safe place to read and write the shapes the engine cares about.
 *
 * The `outputEnvelope` accessors enforce the post-Phase-2 contract
 * structurally: every executor produces an envelope here, every consumer
 * reads through `getOutputEnvelope`. The `lastInput*` accessors capture the
 * retry-cache key set that the run loop wipes on every fresh run.
 */

type NodeData = Record<string, unknown> | undefined | null;

/** Read a chat node's message list, or `[]` if absent/malformed. */
export function getChatMessages(data: NodeData): ChatMessage[] {
  const messages = data?.messages;
  return Array.isArray(messages) ? (messages as ChatMessage[]) : [];
}

/** Read a JSON-storage node's record list, or `[]` if absent/malformed. */
export function getStorageRecords(data: NodeData): JSONStorageRecord[] {
  const records = data?.records;
  return Array.isArray(records) ? (records as JSONStorageRecord[]) : [];
}

// ─── Chat ↔ multi-storage merged view ────────────────────────
//
// A Chat node may be wired to many JSON-storage nodes; per-edge permissions
// decide which ones it reads from and writes to. The helpers below give the
// executor and inspector one shared definition of "the chat's record stream"
// so they can never disagree on which records belong to the conversation.

/** Map a stored record back to a chat message. The record's `source` is the
 * label of whoever emitted it ("User", "You", "System", an assistant name, …);
 * the chat distinguishes the User/System roles by that label and treats
 * everything else as assistant. */
export function recordToChatMessage(rec: JSONStorageRecord): ChatMessage {
  const src = (rec.source || "").toLowerCase();
  let role: ChatMessage["role"] = "assistant";
  if (src === "user" || src === "you") role = "user";
  else if (src === "system") role = "system";
  return { role, content: rec.content || "", sender: rec.source };
}

/** Edge between a chat and a storage node, decorated with parsed permissions. */
export interface ChatStorageEdge {
  edge: Edge;
  target: Node;
  hasRead: boolean;
  hasWrite: boolean;
}

/** Resolve every outgoing edge from `chatNodeId` whose target is a jsonStorage
 * node. The decorated permissions on each edge let the executor/inspector
 * decide which ones participate in reads vs writes without re-parsing edge
 * data twice. Bottom storage handle defaults to `read-write`; non-storage
 * handles default to `write-only` (matching connectivity.ts). */
export function getChatStorageEdges(
  chatNodeId: string,
  nodes: Node[],
  edges: Edge[]
): ChatStorageEdge[] {
  const result: ChatStorageEdge[] = [];
  // Sort by edge id so fan-out order is deterministic across runs — partial
  // failures on cancellation hit the same suffix every time.
  const outgoing = edges
    .filter((e) => e.source === chatNodeId)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const e of outgoing) {
    const target = nodes.find((n) => n.id === e.target);
    if (!target || target.type !== "jsonStorage") continue;
    const defaultType = e.sourceHandle === "storage" ? "read-write" : "write-only";
    const raw = e.data?.edgeType as string | undefined;
    const edgeType =
      raw === "read-only" || raw === "write-only" || raw === "read-write"
        ? raw
        : defaultType;
    result.push({
      edge: e,
      target,
      hasRead: edgeType === "read-only" || edgeType === "read-write",
      hasWrite: edgeType === "write-only" || edgeType === "read-write",
    });
  }
  return result;
}

/** Merge records from every read-enabled chat→storage edge into a single
 * timeline. Ordering: ascending by `createdAt` (ISO, if present), falling
 * back to numeric `id` (Date.now() string) for legacy records. Deduplication:
 * records carrying the same `writeBatchId` collapse to the first one (these
 * come from a single chat fan-out turn); records without a batch id are
 * always kept distinct, even if their fields match — divergence between
 * storages is information, not noise. */
export function getMergedChatRecords(
  chatNodeId: string,
  nodes: Node[],
  edges: Edge[]
): JSONStorageRecord[] {
  const storageEdges = getChatStorageEdges(chatNodeId, nodes, edges);
  const all: JSONStorageRecord[] = [];
  for (const se of storageEdges) {
    if (!se.hasRead) continue;
    all.push(...getStorageRecords(se.target.data));
  }

  all.sort((a, b) => {
    const aKey = a.createdAt ?? a.id;
    const bKey = b.createdAt ?? b.id;
    // ISO timestamps and numeric id strings both sort correctly via
    // localeCompare for their respective formats (lexical for ISO, numeric
    // length matches for same-era ids). Mixed comparison falls back to
    // string order which is a stable best-effort.
    if (a.createdAt && b.createdAt) return aKey.localeCompare(bKey);
    if (!a.createdAt && !b.createdAt) return Number(aKey) - Number(bKey);
    return aKey.localeCompare(bKey);
  });

  const seenBatches = new Set<string>();
  const merged: JSONStorageRecord[] = [];
  for (const rec of all) {
    if (rec.writeBatchId) {
      if (seenBatches.has(rec.writeBatchId)) continue;
      seenBatches.add(rec.writeBatchId);
    }
    merged.push(rec);
  }
  return merged;
}

// ─── Output envelope ─────────────────────────────────────────

/** Read the standardized output envelope written by executors, or
 * `undefined` if the node has not yet produced one. */
export function getOutputEnvelope(data: NodeData): NodeOutputEnvelope | undefined {
  const env = data?.outputEnvelope as NodeOutputEnvelope | undefined;
  if (!env || typeof env !== "object") return undefined;
  if (typeof env.value !== "string") return undefined;
  return env;
}

/** Return a shallow-merged copy of `data` with `outputEnvelope` set.
 * Executors compose this with their own field updates before calling
 * `updateNodeData`. */
export function setOutputEnvelope(
  data: NodeData,
  envelope: NodeOutputEnvelope
): Record<string, unknown> {
  return { ...(data ?? {}), outputEnvelope: envelope };
}

// ─── Retry-cache keys (`lastInput*`) ─────────────────────────
//
// Executors save the input they resolved on first execution under one of
// these keys, then prefer it over the upstream walk on the retry path. The
// run loop wipes the whole set on every fresh trigger / chat send (see
// runLoop.ts), so they only persist within a workflow's single run.

/** The full set of run-loop-managed retry-cache keys. Mirror this in
 * `runLoop.ts::isFreshRun` if a new key is added. */
export const LAST_INPUT_KEYS = [
  "lastInputMessages",
  "lastInputText",
  "lastInputSender",
  "lastInputEnvelope",
] as const;

export type LastInputKey = (typeof LAST_INPUT_KEYS)[number];

/** Read one of the retry-cache values without re-typing the cast at every
 * call site. Returns `undefined` if absent. */
export function getLastInput<T = unknown>(
  data: NodeData,
  key: LastInputKey
): T | undefined {
  const v = data?.[key];
  return v === null ? undefined : (v as T | undefined);
}
