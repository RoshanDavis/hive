import { invoke } from "@tauri-apps/api/core";
import type { ExecutionContext, NodeExecutor } from "./types";

export class OllamaExecutor implements NodeExecutor {
  async execute({ node, nodes, edges, updateNodeData, showToast }: ExecutionContext): Promise<void> {
    const url = String(node.data?.ollamaUrl || "http://localhost:11434");
    const model = String(node.data?.model || "llama3");
    const systemPrompt = String(node.data?.systemPrompt || "");
    const temp = Number(node.data?.temperature || 0.7);
    const maxT = Number(node.data?.maxTokens || 2048);

    // Find incoming chat node
    const incomingEdges = edges.filter(e => e.target === node.id);
    const incomingChatNodes = nodes.filter(n => 
      n.type === "chat" && incomingEdges.some(e => e.source === n.id)
    );
    
    let ollamaMessages: any[] = [];
    let chatNodeId = "";
    
    if (incomingChatNodes.length > 0) {
      chatNodeId = incomingChatNodes[0].id;
      const rawMessages = incomingChatNodes[0].data?.messages as any[] || [];
      ollamaMessages = [...rawMessages];
    } else {
      showToast("Ollama node needs a connected Chat node for input", "error");
      return;
    }

    if (systemPrompt.trim() !== "") {
      ollamaMessages.unshift({ role: "system", content: systemPrompt });
    }

    try {
      const response = await invoke<string>("ollama_chat", {
        ollamaUrl: url,
        model,
        messages: ollamaMessages,
        temperature: temp,
        maxTokens: maxT
      });

      // Update Chat Node with response
      if (chatNodeId) {
        const chatNode = nodes.find(n => n.id === chatNodeId);
        if (chatNode) {
          const currentMessages = (chatNode.data?.messages as any[]) || [];
          updateNodeData(chatNodeId, {
            ...chatNode.data,
            messages: [...currentMessages, { role: "assistant", content: response }]
          });
        }
      }

      // Send response to downstream output node
      const outgoingEdges = edges.filter(e => e.source === node.id);
      const outgoingOutputNodes = nodes.filter(n =>
        n.type === "output" && outgoingEdges.some(e => e.target === n.id)
      );

      if (outgoingOutputNodes.length > 0) {
        updateNodeData(outgoingOutputNodes[0].id, {
          ...outgoingOutputNodes[0].data,
          outputContent: response
        });
      } else {
        showToast("Ollama finished, but no Output node connected", "info");
      }
    } catch (err) {
      showToast(`Ollama error: ${err}`, "error");
    }
  }
}
