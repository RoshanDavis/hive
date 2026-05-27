import type { Node } from "@xyflow/react";

// ─── Node data types ─────────────────────────────────────────
export interface TriggerNodeData {
  label: string;
  [key: string]: unknown;
}

export interface NotifyNodeData {
  label: string;
  message: string;
  output: string;
  [key: string]: unknown;
}

export interface LLMNodeData {
  label: string;
  provider?: "Ollama" | "OpenAI" | "Anthropic" | "Google" | "Other";
  baseURL?: string;
  /** @deprecated Inline API keys are migrated to the credential vault. Kept only for backward-compat reads during migration. */
  apiKey?: string;
  /** ID of a credential in the vault (global or local). Resolved Rust-side at execution time. */
  credentialId?: string;
  modelName?: string;

  // Legacy Ollama-only fields for backward compatibility
  model?: string;
  ollamaUrl?: string;

  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  chatHistoryLimit: number;
  [key: string]: unknown;
}

export type OllamaNodeData = LLMNodeData;

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
  outputContent: string;
  [key: string]: unknown;
}

export interface JSONStorageRecord {
  id: string;
  timestamp: string;
  source: string;
  content: string;
}

export interface JSONStorageNodeData {
  label: string;
  records: JSONStorageRecord[];
  [key: string]: unknown;
}

export type TriggerNode = Node<TriggerNodeData, "trigger">;
export type NotifyNode = Node<NotifyNodeData, "notify">;
export type LLMNode = Node<LLMNodeData, "ollama" | "llm">;
export type OllamaNode = LLMNode;
export type ChatNode = Node<ChatNodeData, "chat">;
export type OutputNode = Node<OutputNodeData, "output" | "outputNode">;
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

