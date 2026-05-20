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
    
    // Find connected database node if any
    const dbNode = nodes.find(
      (n) =>
        n.type === "database" &&
        edges.some(
          (e) =>
            (e.source === chatNode.id && e.target === n.id) ||
            (e.source === n.id && e.target === chatNode.id)
        )
    );

    // Save user message to database node if connected
    if (dbNode) {
      const dbRecords = (dbNode.data?.records as any[]) || [];
      const newRecord = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        source: "User",
        content: chatInput
      };
      updateNodeData(dbNode.id, {
        ...dbNode.data,
        records: [...dbRecords, newRecord]
      });
    }

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

    // Read history from database records if database node is connected, otherwise use newMessages
    let ollamaApiMessages = [...newMessages];
    if (dbNode) {
      const dbRecords = (dbNode.data?.records as any[]) || [];
      // Include the newly added user message as well
      const updatedRecords = [
        ...dbRecords,
        {
          id: Date.now().toString(),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          source: "User",
          content: chatInput
        }
      ];
      ollamaApiMessages = updatedRecords.map((rec: any) => {
        const src = (rec.source || "").toLowerCase();
        let role: "user" | "assistant" | "system" = "assistant";
        if (src === "user" || src === "you") {
          role = "user";
        } else if (src === "system") {
          role = "system";
        }
        return { role, content: rec.content || "" };
      });
    }

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

      // Save assistant response to database node if connected
      if (dbNode) {
        // Fetch fresh dbNode records since it might have updated
        const currentDbNode = nodes.find(n => n.id === dbNode.id);
        const freshRecords = (currentDbNode?.data?.records as any[]) || [];
        const assistantRecord = {
          id: (Date.now() + 1).toString(),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          source: "Agent",
          content: response
        };
        updateNodeData(dbNode.id, {
          ...dbNode.data,
          records: [...freshRecords, assistantRecord]
        });
      }

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
