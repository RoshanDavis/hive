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

// ─── Agent node (composite container) ────────────────────────
// The Agent bundles an LLM + memory (storage) + tools into one node. Its inner
// parts are *slots* stored in node.data (not separate React-Flow nodes), so the
// whole thing round-trips as opaque JSON and reuses the existing run loop/edge
// machinery. See docs/agent-node.md.

/** LLM config embedded in an Agent's LLM slot. Same shape the LLM node uses
 * (minus its label) so the shared inference path consumes it unchanged. */
export type AgentLLMSlot = Omit<LLMNodeData, "label">;

/** Storage backend embedded in an Agent's Storage slot. `kind` is open for
 * future backends (postgres/sqlite/mongo/yaml); only "jsonStorage" today.
 * `records` are decoupled to .hive/storage/<space>/<agentId>.json on save. */
export interface AgentStorageSlot {
  kind: "jsonStorage";
  records: JSONStorageRecord[];
  [key: string]: unknown;
}

/** Tools selected for an Agent's Tools slot. Each list holds references (ids)
 * into the tools registry. Runtime invocation is deferred; these persist and
 * display today. */
export interface AgentToolsSlot {
  native: string[];
  mcp: string[];
  skills: string[];
  [key: string]: unknown;
}

export interface AgentNodeData {
  label: string;
  /** Null until the user fills the slot (drag a node onto it / configure it). */
  llm: AgentLLMSlot | null;
  storage: AgentStorageSlot | null;
  tools: AgentToolsSlot | null;
  [key: string]: unknown;
}

/** The three slots inside an Agent node. */
export type AgentSlotKind = "llm" | "storage" | "tools";

export type TriggerNode = Node<TriggerNodeData, "trigger">;
export type NotifyNode = Node<NotifyNodeData, "notify">;
export type LLMNode = Node<LLMNodeData, "llm">;
export type ChatNode = Node<ChatNodeData, "chat">;
export type OutputNode = Node<OutputNodeData, "output">;
export type JSONStorageNode = Node<JSONStorageNodeData, "jsonStorage">;
export type AgentNode = Node<AgentNodeData, "agent">;
export type HiveNode = TriggerNode | NotifyNode | LLMNode | ChatNode | OutputNode | JSONStorageNode | AgentNode;

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

