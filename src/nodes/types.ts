import type { Node } from "@xyflow/react";

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

export interface OllamaNodeData {
  label: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  ollamaUrl: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
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

export interface DatabaseRecord {
  id: string;
  timestamp: string;
  source: string;
  content: string;
}

export interface DatabaseNodeData {
  label: string;
  records: DatabaseRecord[];
  [key: string]: unknown;
}

export type TriggerNode = Node<TriggerNodeData, "trigger">;
export type NotifyNode = Node<NotifyNodeData, "notify">;
export type OllamaNode = Node<OllamaNodeData, "ollama">;
export type ChatNode = Node<ChatNodeData, "chat">;
export type OutputNode = Node<OutputNodeData, "output">;
export type DatabaseNode = Node<DatabaseNodeData, "database">;
export type HiveNode = TriggerNode | NotifyNode | OllamaNode | ChatNode | OutputNode | DatabaseNode;

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

import {
  TriggerInspector,
  NotifyInspector,
  OllamaInspector,
  ChatInspector,
  OutputInspector,
  DatabaseInspector
} from "../components/inspectors";

export const NODE_REGISTRY: NodeDefinition[] = [
  {
    type: "trigger",
    label: "Trigger",
    icon: "⚡",
    description: "Starts the workflow when clicked",
    defaultData: { label: "Trigger" },
    inspector: TriggerInspector,
  },
  {
    type: "notify",
    label: "Notify",
    icon: "🔔",
    description: "Sends an OS notification",
    defaultData: { label: "Notify", message: "Hello from Hive!" },
    inspector: NotifyInspector,
  },
  {
    type: "ollama",
    label: "Ollama Agent",
    icon: "🤖",
    description: "LLM Agent using Ollama",
    defaultData: {
      label: "Ollama Agent",
      model: "llama3",
      systemPrompt: "You are a helpful AI assistant.",
      temperature: 0.7,
      maxTokens: 2048,
      ollamaUrl: "http://localhost:11434",
    },
    inspector: OllamaInspector,
  },
  {
    type: "chat",
    label: "Chat",
    icon: "💬",
    description: "Provides chat input to an agent",
    defaultData: { label: "Chat Input", messages: [] },
    inspector: ChatInspector,
  },
  {
    type: "output",
    label: "Output",
    icon: "📤",
    description: "Displays the output",
    defaultData: { label: "Output", outputContent: "" },
    inspector: OutputInspector,
  },
  {
    type: "database",
    label: "Database",
    icon: "🛢️",
    description: "Structured data storage for messages and execution logs",
    defaultData: { label: "Database", records: [] },
    inspector: DatabaseInspector,
  },
];
