import type { Node } from "@xyflow/react";
import type { NodeOutputEnvelope } from "@/engine/types";

// ─── Node data types ─────────────────────────────────────────
export interface TriggerNodeData {
  label: string;
  [key: string]: unknown;
}

export interface NotifyNodeData {
  label: string;
  message: string;
  [key: string]: unknown;
}

export interface LLMNodeData {
  label: string;
  provider?: "Ollama" | "OpenAI" | "Anthropic" | "Google" | "Other";
  baseURL?: string;
  /** ID of a credential in the vault (global or local). Resolved Rust-side at execution time. */
  credentialId?: string;
  modelName?: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  chatHistoryLimit: number;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  sender?: string;
}

export interface ChatNodeData {
  label: string;
  messages: ChatMessage[];
  [key: string]: unknown;
}

export interface OutputNodeData {
  label: string;
  [key: string]: unknown;
}

export interface JSONStorageRecord {
  id: string;
  timestamp: string;
  source: string;
  content: string;
  envelope?: NodeOutputEnvelope;
  /** ISO timestamp written at record creation. Used for cross-day ordering
   * when records are merged across multiple storage nodes. Optional for
   * backward compatibility — legacy records fall back to numeric `id`. */
  createdAt?: string;
  /** Shared id for records emitted by a single chat fan-out turn. Used by
   * the merged-read path to collapse known-duplicate writes without
   * false-collapsing manually-edited records that happen to match. */
  writeBatchId?: string;
}

export interface JSONStorageNodeData {
  label: string;
  records: JSONStorageRecord[];
  [key: string]: unknown;
}

export type TriggerNode = Node<TriggerNodeData, "trigger">;
export type NotifyNode = Node<NotifyNodeData, "notify">;
export type LLMNode = Node<LLMNodeData, "llm">;
export type ChatNode = Node<ChatNodeData, "chat">;
export type OutputNode = Node<OutputNodeData, "output">;
export type JSONStorageNode = Node<JSONStorageNodeData, "jsonStorage">;
export type HiveNode = TriggerNode | NotifyNode | LLMNode | ChatNode | OutputNode | JSONStorageNode;

import React from "react";

// ─── Node registry (for palette) ────────────────────────────
export interface NodeDefinition {
  type: string;
  label: string;
  icon: string;
  description: string;
  defaultData: Record<string, unknown>;
  inspector?: React.ComponentType<any>;
}

