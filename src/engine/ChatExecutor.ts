import { invoke } from "@tauri-apps/api/core";
import type { ExecutionContext, NodeExecutor } from "./types";

export interface ChatExecutionContext extends ExecutionContext {
  chatInput?: string;
  executeNode?: (nodeType: string, context: ChatExecutionContext) => Promise<void>;
}

export class ChatExecutor implements NodeExecutor {
  async execute({ node, nodes, edges, updateNodeData, showToast, chatInput, executeNode }: ChatExecutionContext): Promise<void> {
    if (!chatInput) return;

    const chatNode = node;
    
    // Find connected Ollama node connected via normal source handle (not the storage handle)
    const outgoingEdges = edges.filter(e => e.source === chatNode.id);
    const ollamaNodes = nodes.filter(
      n => n.type === "ollama" && outgoingEdges.some(e => e.target === n.id && e.sourceHandle !== "storage")
    );
    
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
    const historyLimit = Number(ollamaNode.data?.chatHistoryLimit || 0);

    // Find connected JSON storage node specifically connected to the Chat node's bottom "storage" handle
    const storageEdge = edges.find(
      (e) => e.source === chatNode.id && e.sourceHandle === "storage"
    );
    const storageNode = storageEdge
      ? nodes.find((n) => n.id === storageEdge.target && n.type === "jsonStorage")
      : null;

    let ollamaApiMessages: { role: "user" | "assistant" | "system"; content: string }[] = [];
    let storageRecords: any[] = [];

    if (storageNode) {
      const dbRecords = (storageNode.data?.records as any[]) || [];
      const newRecord = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        source: "User",
        content: chatInput
      };
      
      storageRecords = [...dbRecords, newRecord];
      updateNodeData(storageNode.id, {
        ...storageNode.data,
        records: storageRecords
      });

      // Update chat messages locally to show the history so far (including the new user message)
      const currentMessages = (chatNode.data?.messages as any[]) || [];
      updateNodeData(chatNode.id, {
        ...chatNode.data,
        messages: [...currentMessages, { role: "user", content: chatInput }]
      });

      // Apply the sliding window context history limit if configured
      let activeRecords = storageRecords;
      if (historyLimit > 0 && activeRecords.length > historyLimit) {
        activeRecords = activeRecords.slice(-historyLimit);
      }

      ollamaApiMessages = activeRecords.map((rec: any) => {
        const src = (rec.source || "").toLowerCase();
        let role: "user" | "assistant" | "system" = "assistant";
        if (src === "user" || src === "you") {
          role = "user";
        } else if (src === "system") {
          role = "system";
        }
        return { role, content: rec.content || "" };
      });
    } else {
      // Single-turn chat by default
      const newMessages = [{ role: "user", content: chatInput }];
      updateNodeData(chatNode.id, {
        ...chatNode.data,
        messages: newMessages
      });
      ollamaApiMessages = [{ role: "user", content: chatInput }];
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

      if (storageNode) {
        const assistantRecord = {
          id: (Date.now() + 1).toString(),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          source: "Agent",
          content: response
        };
        storageRecords = [...storageRecords, assistantRecord];
        updateNodeData(storageNode.id, {
          ...storageNode.data,
          records: storageRecords
        });

        // Sync ChatNode messages to full history
        const fullHistory = storageRecords.map((rec: any) => {
          const src = (rec.source || "").toLowerCase();
          let role: "user" | "assistant" | "system" = "assistant";
          if (src === "user" || src === "you") {
            role = "user";
          } else if (src === "system") {
            role = "system";
          }
          return { role, content: rec.content || "" };
        });

        updateNodeData(chatNode.id, {
          ...chatNode.data,
          messages: fullHistory
        });
      } else {
        // Single-turn chat - only user input & latest response
        updateNodeData(chatNode.id, {
          ...chatNode.data,
          messages: [
            { role: "user", content: chatInput },
            { role: "assistant", content: response }
          ]
        });
      }

      // Update Ollama node itself with the response
      updateNodeData(ollamaNode.id, {
        ...ollamaNode.data,
        lastResponse: response
      });

      const ollamaOutgoingEdges = edges.filter(e => e.source === ollamaNode.id);
      const outputNodes = nodes.filter(n => (n.type === "output" || n.type === "outputNode") && ollamaOutgoingEdges.some(e => e.target === n.id));
      
      for (const outNode of outputNodes) {
        updateNodeData(outNode.id, {
          ...outNode.data,
          outputContent: response
        });
      }

      // Propagate execution downstream from the Ollama node
      if (executeNode) {
        const visited = new Set<string>();
        const queue: string[] = ollamaOutgoingEdges
          .filter(e => {
            const targetNode = nodes.find(n => n.id === e.target);
            return !!targetNode;
          })
          .map(e => e.target);

        while (queue.length > 0) {
          const currentId = queue.shift()!;
          if (visited.has(currentId)) continue;
          visited.add(currentId);

          const currentNode = nodes.find(n => n.id === currentId);
          if (!currentNode) continue;

          await executeNode(currentNode.type || "default", {
            node: currentNode,
            nodes,
            edges,
            updateNodeData,
            showToast,
            executeNode
          });

          const downstream = edges
            .filter(e => e.source === currentId)
            .map(e => e.target);
          queue.push(...downstream);
        }
      }

    } catch (err) {
      showToast(`Ollama error: ${err}`, "error");
    }
  }
}
