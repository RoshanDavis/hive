import { api } from "@/services/api";
import { concurrencyGovernor } from "@/services/concurrency";
import type { ExecutionContext, NodeExecutor, NodeOutputEnvelope } from "./types";
import { getUpstreamNodeData } from "./utils";
import { getChatMessages } from "./nodeData";
import type { ChatMessage } from "@/nodes/types";

export class LLMExecutor implements NodeExecutor {
  async execute(context: ExecutionContext): Promise<void> {
    const { node, nodes, edges, updateNodeData, showToast, visited, workspacePath } = context;

    const provider = String(node.data?.provider || "Ollama");
    let defaultBaseURL = "";
    if (provider === "Ollama") defaultBaseURL = "http://localhost:11434";
    else if (provider === "OpenAI") defaultBaseURL = "https://api.openai.com/v1";
    else if (provider === "Anthropic") defaultBaseURL = "https://api.anthropic.com";
    else if (provider === "Google") defaultBaseURL = "https://generativelanguage.googleapis.com/v1beta/openai";

    const baseURL = String(node.data?.baseURL !== undefined ? node.data?.baseURL : (node.data?.ollamaUrl !== undefined ? node.data?.ollamaUrl : defaultBaseURL));
    const modelName = String(node.data?.modelName !== undefined ? node.data?.modelName : (node.data?.model !== undefined ? node.data?.model : ""));
    // Credential resolution happens in Rust. We pass either the credentialId or
    // the legacy inline apiKey (for not-yet-migrated nodes); never both meaningfully.
    const credentialId = (node.data?.credentialId as string | undefined) ?? null;
    const legacyApiKey = String(node.data?.apiKey || "");

    // Known cloud providers always need a key; Ollama is local and "Other" may
    // point at an unauthenticated self-hosted endpoint, so we don't enforce
    // there. Fail early with an actionable message instead of a generic 401.
    const requiresCredential =
      provider === "OpenAI" || provider === "Anthropic" || provider === "Google";
    if (requiresCredential && !credentialId && !legacyApiKey) {
      throw new Error(
        `No credential selected for ${provider}. Open the LLM inspector and pick or add one.`
      );
    }

    const systemPrompt = String(node.data?.systemPrompt || "");
    const temp = Number(node.data?.temperature || 0.7);
    const maxT = Number(node.data?.maxTokens || 2048);
    const historyLimit = Number(node.data?.chatHistoryLimit || 0);

    // Dynamically resolve pool: local vs. cloud based on configured address wildcards
    const isLocal = concurrencyGovernor.isLocalModel(provider, baseURL);
    const poolType = isLocal ? "local" : "cloud";

    await concurrencyGovernor.enqueue(poolType, async () => {
      // Find all upstream edges where LLM is target, OR where LLM is source but edge is bi-directional
      const upstreamEdges = edges.filter(e => 
        e.target === node.id || 
        (e.source === node.id && e.data?.edgeType === "bi-directional")
      );
      const upstreamNodes = nodes.filter(n => 
        upstreamEdges.some(e => e.source === n.id || e.target === n.id) && n.id !== node.id
      );

      // Filter to only allow upstream nodes that are in the active run path (visited Set)
      const visitedNodes = upstreamNodes.filter(n => !visited || visited.has(n.id));

      let llmMessages: ChatMessage[] = [];

      // Check if we are retrying and already have a saved lastInputMessages
      if (node.data?.lastInputMessages && Array.isArray(node.data.lastInputMessages) && node.data.lastInputMessages.length > 0) {
        llmMessages = [...(node.data.lastInputMessages as ChatMessage[])];
      } else {
        // 1. If an upstream Chat node exists on the active run path, load the full conversation log
        const chatNode = visitedNodes.find(n => n.type === "chat");
        if (chatNode) {
          let rawMessages = getChatMessages(chatNode.data);
          if (historyLimit > 0 && rawMessages.length > historyLimit) {
            rawMessages = rawMessages.slice(-historyLimit);
          }
          llmMessages = [...rawMessages];
        }

        // 2. If no Chat node or empty chat, resolve input generically from visited upstream nodes
        if (llmMessages.length === 0) {
          let resolvedText = "";
          for (const upstream of visitedNodes) {
            const val = getUpstreamNodeData(upstream);
            if (val !== null) {
              resolvedText = val;
              break;
            }
          }

          if (resolvedText) {
            llmMessages = [{ role: "user" as const, content: resolvedText }];
          } else {
            throw new Error("No upstream input data found.");
          }
        }

        // Save resolved messages to node.data.lastInputMessages so we can reuse them on retry
        updateNodeData(node.id, {
          ...node.data,
          lastInputMessages: llmMessages
        });
      }

      // 3. Prepend system prompt if configured
      if (systemPrompt.trim() !== "") {
        llmMessages.unshift({ role: "system", content: systemPrompt });
      }

      try {
        const response = await api.llmChat(
          provider,
          baseURL,
          legacyApiKey,
          modelName,
          llmMessages,
          temp,
          maxT,
          credentialId,
          null,
          workspacePath
        );

        // 4. Create standard JSON envelope
        const outputEnvelope: NodeOutputEnvelope = {
          value: response,
          metadata: {
            model: modelName,
            provider,
            temperature: temp,
            maxTokens: maxT,
            timestamp: new Date().toISOString()
          },
          data: {
            reply: response
          }
        };

        // 5. Update the LLM node with the response and rich envelope
        updateNodeData(node.id, {
          ...node.data,
          lastResponse: response,
          outputEnvelope
        });
      } catch (err) {
        showToast(`LLM execution error: ${err}`, "error");
        throw err;
      }
    });
  }
}
