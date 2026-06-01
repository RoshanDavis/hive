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
