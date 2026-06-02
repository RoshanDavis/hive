// Shared LLM inference path, factored out of LLMExecutor so both the LLM node
// and the Agent node (whose LLM slot is just an embedded LLM config) run through
// one place. Keeps provider/baseURL resolution, input-message resolution, the
// concurrency-pool gate, and the output-envelope shape identical across both.

import { api } from "@/services/api";
import type { AgentChatMessage, AgentTurn, ToolSchema } from "@/services/api";
import { concurrencyGovernor } from "@/services/concurrency";
import type { ExecutionContext, NodeOutputEnvelope } from "./types";
import { getUpstreamNodeData, getUpstreamNodes } from "./utils";
import { getChatMessages, getLastInput } from "./nodeData";
import type { ChatMessage } from "@/nodes/types";

/** Resolved, executor-ready LLM settings. Mirrors the fields on LLMNodeData. */
export interface LlmConfig {
  provider: string;
  baseURL: string;
  modelName: string;
  /** Vault id; the plaintext key is resolved Rust-side. */
  credentialId: string | null;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  chatHistoryLimit: number;
}

/** Default base URL applied when the data blob doesn't carry one. */
function defaultBaseURL(provider: string): string {
  if (provider === "Ollama") return "http://localhost:11434";
  if (provider === "OpenAI") return "https://api.openai.com/v1";
  if (provider === "Anthropic") return "https://api.anthropic.com";
  if (provider === "Google") return "https://generativelanguage.googleapis.com/v1beta/openai";
  return "";
}

/**
 * Read an LLM config out of a data blob. Works for both an LLM node's
 * `node.data` and an Agent node's `node.data.llm` slot.
 */
export function resolveLlmConfig(data: Record<string, unknown> | null | undefined): LlmConfig {
  const provider = String(data?.provider || "Ollama");
  return {
    provider,
    baseURL: String(data?.baseURL ?? defaultBaseURL(provider)),
    modelName: String(data?.modelName ?? ""),
    credentialId: (data?.credentialId as string | undefined) ?? null,
    systemPrompt: String(data?.systemPrompt || ""),
    temperature: Number(data?.temperature || 0.7),
    maxTokens: Number(data?.maxTokens || 2048),
    chatHistoryLimit: Number(data?.chatHistoryLimit || 0),
  };
}

/**
 * Known cloud providers always need a key. Ollama is local and "Other" may
 * point at an unauthenticated self-hosted endpoint, so neither is enforced.
 * Callers throw their own contextual message (LLM inspector vs. Agent slot).
 */
export function llmRequiresCredential(provider: string): boolean {
  return provider === "OpenAI" || provider === "Anthropic" || provider === "Google";
}

/**
 * Resolve the conversation/input to feed the model from upstream nodes:
 *   1. Reuse `lastInputMessages` if a previous run cached it (retry path).
 *   2. Else an upstream Chat node's full conversation (clamped to historyLimit).
 *   3. Else the first non-null upstream envelope value as a single user message.
 * Caches the resolved messages on `node.data.lastInputMessages` (a clone, so the
 * system-prompt prepend in `callLlm` can't mutate the cache and duplicate it on
 * retries). Throws if no upstream input is found.
 */
export function resolveLlmInputMessages(
  context: ExecutionContext,
  historyLimit: number
): ChatMessage[] {
  const { node, nodes, edges, updateNodeData, visited } = context;

  const cached = getLastInput<ChatMessage[]>(node.data, "lastInputMessages");
  if (cached && Array.isArray(cached) && cached.length > 0) {
    return [...cached];
  }

  // Bi-directional: include neighbors on the reverse side of bi-dir edges too.
  // Already filtered by `visited` so cross-run noise stays out.
  const visitedNodes = getUpstreamNodes(node.id, edges, nodes, {
    visited,
    includeBiDirectional: true,
  });

  let messages: ChatMessage[] = [];

  const chatNode = visitedNodes.find((n) => n.type === "chat");
  if (chatNode) {
    let rawMessages = getChatMessages(chatNode.data);
    if (historyLimit > 0 && rawMessages.length > historyLimit) {
      rawMessages = rawMessages.slice(-historyLimit);
    }
    messages = [...rawMessages];
  }

  if (messages.length === 0) {
    let resolvedText = "";
    for (const upstream of visitedNodes) {
      const val = getUpstreamNodeData(upstream);
      if (val !== null) {
        resolvedText = val;
        break;
      }
    }
    if (resolvedText) {
      messages = [{ role: "user", content: resolvedText }];
    } else {
      throw new Error("No upstream input data found.");
    }
  }

  updateNodeData(node.id, { ...node.data, lastInputMessages: [...messages] });

  return messages;
}

/**
 * Run a single inference, pool-gated by local-vs-cloud. Prepends the system
 * prompt (if any) without mutating `messages`, and returns the standard output
 * envelope. Does NOT touch node data or toasts — the caller owns those.
 */
export function callLlm(
  config: LlmConfig,
  messages: ChatMessage[],
  workspacePath: string
): Promise<NodeOutputEnvelope> {
  const isLocal = concurrencyGovernor.isLocalModel(config.provider, config.baseURL);
  const poolType = isLocal ? "local" : "cloud";

  return concurrencyGovernor.enqueue(poolType, async () => {
    const requestMessages: ChatMessage[] =
      config.systemPrompt.trim() !== ""
        ? [{ role: "system", content: config.systemPrompt }, ...messages]
        : messages;

    const response = await api.llmChat(
      config.provider,
      config.baseURL,
      config.modelName,
      requestMessages,
      config.temperature,
      config.maxTokens,
      config.credentialId,
      null,
      workspacePath
    );

    return {
      value: response,
      metadata: {
        model: config.modelName,
        provider: config.provider,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        timestamp: new Date().toISOString(),
      },
      data: { reply: response },
    };
  });
}

/**
 * One tool-calling inference turn, pool-gated identically to {@link callLlm} (so a
 * pool slot is released while tools execute between turns). Prepends the composed
 * system prompt (if any) without mutating `messages`; returns the model's text and
 * any tool-call requests. The Agent loop calls this repeatedly, appending the
 * assistant turn + tool results to `messages` between calls.
 */
export function callLlmWithTools(
  config: LlmConfig,
  messages: AgentChatMessage[],
  tools: ToolSchema[],
  workspacePath: string
): Promise<AgentTurn> {
  const isLocal = concurrencyGovernor.isLocalModel(config.provider, config.baseURL);
  const poolType = isLocal ? "local" : "cloud";

  return concurrencyGovernor.enqueue(poolType, async () => {
    const requestMessages: AgentChatMessage[] =
      config.systemPrompt.trim() !== ""
        ? [{ role: "system", content: config.systemPrompt }, ...messages]
        : messages;

    return api.llmChatTools(
      config.provider,
      config.baseURL,
      config.modelName,
      requestMessages,
      config.temperature,
      config.maxTokens,
      tools,
      config.credentialId,
      null,
      workspacePath
    );
  });
}
