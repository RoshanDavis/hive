import { api } from "@/services/api";
import { concurrencyGovernor } from "@/services/concurrency";
import type { ExecutionContext, NodeExecutor, NodeOutputEnvelope } from "./types";
import { getUpstreamNodeData } from "./utils";

export class OllamaExecutor implements NodeExecutor {
  async execute(context: ExecutionContext): Promise<void> {
    const { node, nodes, edges, updateNodeData, showToast, visited } = context;
    await concurrencyGovernor.enqueue("ollama", async () => {

    const url = String(node.data?.ollamaUrl || "http://localhost:11434");
    const model = String(node.data?.model || "llama3");
    const systemPrompt = String(node.data?.systemPrompt || "");
    const temp = Number(node.data?.temperature || 0.7);
    const maxT = Number(node.data?.maxTokens || 2048);
    const historyLimit = Number(node.data?.chatHistoryLimit || 0);

    // Find all upstream edges where Ollama is target, OR where Ollama is source but edge is bi-directional
    const upstreamEdges = edges.filter(e => 
      e.target === node.id || 
      (e.source === node.id && e.data?.edgeType === "bi-directional")
    );
    const upstreamNodes = nodes.filter(n => 
      upstreamEdges.some(e => e.source === n.id || e.target === n.id) && n.id !== node.id
    );

    // Filter to only allow upstream nodes that are in the active run path (visited Set)
    const visitedNodes = upstreamNodes.filter(n => !visited || visited.has(n.id));

    let ollamaMessages: any[] = [];

    // 1. If an upstream Chat node exists on the active run path, load the full conversation log
    const chatNode = visitedNodes.find(n => n.type === "chat");
    if (chatNode) {
      let rawMessages = chatNode.data?.messages as any[] || [];
      if (historyLimit > 0 && rawMessages.length > historyLimit) {
        rawMessages = rawMessages.slice(-historyLimit);
      }
      ollamaMessages = [...rawMessages];
    }

    // 2. If no Chat node or empty chat, resolve input generically from visited upstream nodes
    if (ollamaMessages.length === 0) {
      let resolvedText = "";
      for (const upstream of visitedNodes) {
        const val = getUpstreamNodeData(upstream);
        if (val !== null) {
          resolvedText = val;
          break;
        }
      }

      if (resolvedText) {
        ollamaMessages = [{ role: "user" as const, content: resolvedText }];
      } else {
        showToast("Ollama node: No upstream input data found.", "error");
        return;
      }
    }

    // 3. Prepend system prompt if configured
    if (systemPrompt.trim() !== "") {
      ollamaMessages.unshift({ role: "system", content: systemPrompt });
    }

    try {
      const response = await api.ollamaChat(
        url,
        model,
        ollamaMessages,
        temp,
        maxT
      );

      // 4. Create standard JSON envelope
      const outputEnvelope: NodeOutputEnvelope = {
        value: response,
        metadata: {
          model,
          temperature: temp,
          maxTokens: maxT,
          timestamp: new Date().toISOString()
        },
        data: {
          reply: response
        }
      };

      // 5. Update the Ollama node with the response and rich envelope
      updateNodeData(node.id, {
        ...node.data,
        lastResponse: response,
        outputEnvelope
      });
    } catch (err) {
      showToast(`Ollama error: ${err}`, "error");
      throw err;
    }
    });
  }
}
