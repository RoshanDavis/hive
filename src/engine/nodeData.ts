import type { ChatMessage, JSONStorageRecord } from "@/nodes/types";

/**
 * Typed accessors for node data that lives untyped on React Flow's
 * `node.data` (a `Record<string, unknown>`). Centralizing these removes the
 * scattered `as any[]` casts and gives a single, safe place to read the two
 * array shapes the engine cares about: chat messages and storage records.
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
