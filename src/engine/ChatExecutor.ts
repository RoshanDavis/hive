import type { ExecutionContext, NodeExecutor, NodeOutputEnvelope } from "./types";
import { getUpstreamNodeData } from "./utils";

export class ChatExecutor implements NodeExecutor {
  async execute(context: ExecutionContext): Promise<void> {
    const { node: chatNode, nodes, edges, updateNodeData, chatInput, visited } = context;

    // Find connected JSON storage node specifically connected to the Chat node's bottom "storage" handle
    const storageEdge = edges.find(
      (e) => e.source === chatNode.id && e.sourceHandle === "storage"
    );
    const storageNode = storageEdge
      ? nodes.find((n) => n.id === storageEdge.target && n.type === "jsonStorage")
      : null;

    if (chatInput !== undefined && chatInput !== null) {
      // ─── Case A: User sent a message (Input Mode) ───
      const storageEdgeType = (storageEdge?.data?.edgeType as string) || "read-write";
      const hasWritePermission = storageEdgeType === "write-only" || storageEdgeType === "read-write";
      const hasReadPermission = storageEdgeType === "read-only" || storageEdgeType === "read-write";

      let updatedLocalMessages = (chatNode.data?.messages as any[]) || [];

      if (storageNode && hasWritePermission) {
        const dbRecords = (storageNode.data?.records as any[]) || [];
        const newRecord = {
          id: Date.now().toString(),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          source: "User",
          content: chatInput
        };
        const storageRecords = [...dbRecords, newRecord];
        updateNodeData(storageNode.id, {
          ...storageNode.data,
          records: storageRecords
        });

        if (hasReadPermission) {
          // Sync ChatNode messages to full history
          updatedLocalMessages = storageRecords.map((rec: any) => {
            const src = (rec.source || "").toLowerCase();
            let role: "user" | "assistant" | "system" = "assistant";
            if (src === "user" || src === "you") {
              role = "user";
            } else if (src === "system") {
              role = "system";
            }
            return { role, content: rec.content || "", sender: rec.source };
          });
        } else {
          // Write-only: just append to local messages independently
          updatedLocalMessages = [...updatedLocalMessages, { role: "user" as const, content: chatInput, sender: "You" }];
        }
      } else {
        // No storage node, or no write permission - append to local state only
        updatedLocalMessages = [...updatedLocalMessages, { role: "user" as const, content: chatInput, sender: "You" }];
      }

      const outputEnvelope: NodeOutputEnvelope = {
        value: chatInput,
        metadata: {
          chatHistoryLimit: Number(chatNode.data?.chatHistoryLimit || 0),
          messageCount: updatedLocalMessages.length,
          sender: "User",
          timestamp: new Date().toISOString()
        },
        data: {
          messages: updatedLocalMessages,
          latestMessage: chatInput
        }
      };

      updateNodeData(chatNode.id, {
        ...chatNode.data,
        messages: updatedLocalMessages,
        lastResponse: chatInput,
        outputEnvelope
      });
    } else {
      // ─── Case B: Triggered Downstream (Output/Receiver Mode) ───
      let resolvedMessage = "";
      let senderLabel = "Agent";
      
      // Find all upstream edges where Chat is target, OR where Chat is source but edge is bi-directional
      // Exclude storage connections (sourceHandle === "storage" or targetHandle === "storage")
      const upstreamEdges = edges.filter(e => 
        e.sourceHandle !== "storage" &&
        e.targetHandle !== "storage" &&
        (e.target === chatNode.id || 
         (e.source === chatNode.id && e.data?.edgeType === "bi-directional"))
      );

      if (upstreamEdges.length > 0) {
        // Find upstream nodes (the other end of these edges)
        const upstreamNodes = nodes.filter(n => 
          upstreamEdges.some(e => e.source === n.id || e.target === n.id) && n.id !== chatNode.id
        );

        for (const upstream of upstreamNodes) {
          if (visited && !visited.has(upstream.id)) {
            continue;
          }
          const val = getUpstreamNodeData(upstream);
          if (val !== null) {
            resolvedMessage = val;
            senderLabel = String(upstream.data?.label || upstream.type || "Agent");
            break;
          }
        }
      }

      if (!resolvedMessage) {
        if (upstreamEdges.length > 0) {
          // If there are upstream edges but no data is resolved (like a Trigger node connection),
          // treat it as a system message that the workflow has reached the Chat node.
          resolvedMessage = "Workflow reached Chat. Awaiting message...";
        } else {
          // If triggered downstream but no upstream data could be resolved and no upstream edges, do nothing.
          return;
        }
      }

      const storageEdgeType = (storageEdge?.data?.edgeType as string) || "read-write";
      const hasWritePermission = storageEdgeType === "write-only" || storageEdgeType === "read-write";
      const hasReadPermission = storageEdgeType === "read-only" || storageEdgeType === "read-write";

      let updatedLocalMessages = (chatNode.data?.messages as any[]) || [];
      const isSystemMsg = resolvedMessage === "Workflow reached Chat. Awaiting message...";
      const role = isSystemMsg ? ("system" as const) : ("assistant" as const);
      const dbSource = isSystemMsg ? "System" : senderLabel;

      if (storageNode && hasWritePermission) {
        const dbRecords = (storageNode.data?.records as any[]) || [];
        const assistantRecord = {
          id: Date.now().toString(),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          source: dbSource,
          content: resolvedMessage
        };
        const storageRecords = [...dbRecords, assistantRecord];
        updateNodeData(storageNode.id, {
          ...storageNode.data,
          records: storageRecords
        });

        if (hasReadPermission) {
          // Sync ChatNode messages to full history
          updatedLocalMessages = storageRecords.map((rec: any) => {
            const src = (rec.source || "").toLowerCase();
            let r: "user" | "assistant" | "system" = "assistant";
            if (src === "user" || src === "you") {
              r = "user";
            } else if (src === "system") {
              r = "system";
            }
            return { role: r, content: rec.content || "", sender: rec.source };
          });
        } else {
          // Write-only: just append to local messages independently
          updatedLocalMessages = [...updatedLocalMessages, { role, content: resolvedMessage, sender: isSystemMsg ? undefined : senderLabel }];
        }
      } else {
        // No storage node, or read-only connection
        updatedLocalMessages = [...updatedLocalMessages, { role, content: resolvedMessage, sender: isSystemMsg ? undefined : senderLabel }];
      }

      const envelopeValue = isSystemMsg ? "" : resolvedMessage;
      const outputEnvelope: NodeOutputEnvelope = {
        value: envelopeValue,
        metadata: {
          chatHistoryLimit: Number(chatNode.data?.chatHistoryLimit || 0),
          messageCount: updatedLocalMessages.length,
          sender: isSystemMsg ? "System" : senderLabel,
          timestamp: new Date().toISOString()
        },
        data: {
          messages: updatedLocalMessages,
          latestMessage: envelopeValue
        }
      };

      updateNodeData(chatNode.id, {
        ...chatNode.data,
        messages: updatedLocalMessages,
        lastResponse: isSystemMsg ? undefined : resolvedMessage, // Clear lastResponse for system triggers so downstream nodes don't receive stale/placeholder values
        outputEnvelope
      });
    }
  }
}
