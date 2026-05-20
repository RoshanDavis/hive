import { invoke } from "@tauri-apps/api/core";
import type { ExecutionContext, NodeExecutor } from "./types";

export interface ChatExecutionContext extends ExecutionContext {
  chatInput?: string;
}

export class ChatExecutor implements NodeExecutor {
  async execute({ node, nodes, edges, updateNodeData, showToast, chatInput }: ChatExecutionContext): Promise<void> {
    if (!chatInput) return;

    const chatNode = node;
    const currentMessages = (chatNode.data?.messages as any[]) || [];
    const newMessages = [...currentMessages, { role: "user", content: chatInput }];
    
    updateNodeData(chatNode.id, {
      ...chatNode.data,
      messages: newMessages
    });

    const outgoingEdges = edges.filter(e => e.source === chatNode.id);
    const ollamaNodes = nodes.filter(n => n.type === "ollama" && outgoingEdges.some(e => e.target === n.id));
    
    if (ollamaNodes.length === 0) {
      showToast("No connected Ollama node found.", "error");
      return;
    }

    const ollamaNode = ollamaNodes[0];
    const url = String(ollamaNode.data?.ollamaUrl || "http://localhost:11434");
    const model = String(ollamaNode.data?.model || "llama3");
    const systemPrompt = String(ollamaNode.data?.systemPrompt || "");
    const temp = Number(ollamaNode.data?.temperature || 0.7);
    const maxT = Number(ollamaNode.data?.maxTokens || 2048);

    let ollamaApiMessages = [...newMessages];
    if (systemPrompt.trim() !== "") {
      ollamaApiMessages.unshift({ role: "system", content: systemPrompt });
    }

    try {
      const response = await invoke<string>("ollama_chat", {
        ollamaUrl: url,
        model,
        messages: ollamaApiMessages,
        temperature: temp,
        maxTokens: maxT
      });

      updateNodeData(chatNode.id, {
        ...chatNode.data,
        messages: [...newMessages, { role: "assistant", content: response }]
      });

      const ollamaOutgoingEdges = edges.filter(e => e.source === ollamaNode.id);
      const outputNodes = nodes.filter(n => n.type === "output" && ollamaOutgoingEdges.some(e => e.target === n.id));
      
      for (const outNode of outputNodes) {
        updateNodeData(outNode.id, {
          ...outNode.data,
          outputContent: response
        });
      }

    } catch (err) {
      showToast(`Ollama error: ${err}`, "error");
    }
  }
}
