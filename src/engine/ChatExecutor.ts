import { concurrencyGovernor } from "@/services/concurrency";
import type { ExecutionContext, NodeExecutor, NodeOutputEnvelope } from "./types";
import { getUpstreamNodeData, getUpstreamNodes, resolveEdgePermissions } from "./utils";
import { getChatMessages, getLastInput, getStorageRecords, setOutputEnvelope } from "./nodeData";
import type { ChatMessage } from "@/nodes/types";

export class ChatExecutor implements NodeExecutor {
  async execute(context: ExecutionContext): Promise<void> {
    const { node: chatNode, nodes, edges, updateNodeData, chatInput, visited } = context;
    await concurrencyGovernor.enqueue("general", async () => {

      // Find connected JSON storage node specifically connected to the Chat node's bottom "storage" handle
      const storageEdge = edges.find(
        (e) => e.source === chatNode.id && e.sourceHandle === "storage"
      );
      const storageNode = storageEdge
        ? nodes.find((n) => n.id === storageEdge.target && n.type === "jsonStorage")
        : null;

      // Outgoing edges from the chat's standard output handle (not the dedicated
      // bottom storage handle) that target a JSON storage node. Connectivity
      // rules lock these to write-only, so each one just receives an appended
      // record per message — no read-back into chat history.
      const outputStorageEdges = edges.filter(
        (e) =>
          e.source === chatNode.id &&
          e.sourceHandle !== "storage" &&
          nodes.find((n) => n.id === e.target)?.type === "jsonStorage"
      );

      const writeToOutputStorage = (source: string, content: string): void => {
        for (const edge of outputStorageEdges) {
          const { hasWrite } = resolveEdgePermissions(edge, "write-only");
          if (!hasWrite) continue;
          const target = nodes.find((n) => n.id === edge.target);
          if (!target) continue;
          const dbRecords = getStorageRecords(target.data);
          const newRecord = {
            id: Date.now().toString(),
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            source,
            content,
          };
          updateNodeData(target.id, {
            ...target.data,
            records: [...dbRecords, newRecord],
          });
        }
      };

      if (chatInput !== undefined && chatInput !== null) {
        // ─── Case A: User sent a message (Input Mode) ───
        const { hasRead: hasReadPermission, hasWrite: hasWritePermission } =
          resolveEdgePermissions(storageEdge);

        let updatedLocalMessages: ChatMessage[] = getChatMessages(chatNode.data);

        if (storageNode && hasWritePermission) {
          const dbRecords = getStorageRecords(storageNode.data);
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
            updatedLocalMessages = storageRecords.map((rec) => {
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

        writeToOutputStorage("User", chatInput);

        const envelope: NodeOutputEnvelope = {
          value: chatInput,
          metadata: {
            chatHistoryLimit: Number(chatNode.data?.chatHistoryLimit || 0),
            messageCount: updatedLocalMessages.length,
            sender: "User",
            timestamp: new Date().toISOString(),
          },
          data: {
            messages: updatedLocalMessages,
            latestMessage: chatInput,
          },
        };

        updateNodeData(
          chatNode.id,
          setOutputEnvelope({ ...chatNode.data, messages: updatedLocalMessages }, envelope)
        );
      } else {
        // ─── Case B: Triggered Downstream (Output/Receiver Mode) ───
        let resolvedMessage = "";
        let senderLabel = "Agent";

        // Bi-directional + storage-handle filter: walks both directions on
        // bi-dir edges but skips dedicated storage handles so the Chat ⇄
        // jsonStorage edge isn't mistaken for an input source.
        const upstreamNodes = getUpstreamNodes(chatNode.id, edges, nodes, {
          visited,
          includeBiDirectional: true,
          excludeStorageHandles: true,
        });
        const hasUpstream = upstreamNodes.length > 0;

        // Check if we are retrying and already have a saved lastInputText
        const cachedText = getLastInput<string>(chatNode.data, "lastInputText");
        if (cachedText !== undefined) {
          resolvedMessage = String(cachedText);
          senderLabel = String(getLastInput<string>(chatNode.data, "lastInputSender") ?? "Agent");
        } else {
          for (const upstream of upstreamNodes) {
            const val = getUpstreamNodeData(upstream);
            if (val !== null) {
              resolvedMessage = val;
              senderLabel = String(upstream.data?.label || upstream.type || "Agent");
              break;
            }
          }

          // Save resolved input to chatNode.data.lastInputText so we can reuse it on retry
          updateNodeData(chatNode.id, {
            ...chatNode.data,
            lastInputText: resolvedMessage,
            lastInputSender: senderLabel
          });
        }

        if (!resolvedMessage) {
          if (hasUpstream) {
            // If there are upstream edges but no data is resolved (like a Trigger node connection),
            // treat it as a system message that the workflow has reached the Chat node.
            resolvedMessage = "Workflow reached Chat. Awaiting message...";
          } else {
            // If triggered downstream but no upstream data could be resolved and no upstream edges, do nothing.
            return;
          }
        }

        const { hasRead: hasReadPermission, hasWrite: hasWritePermission } =
          resolveEdgePermissions(storageEdge);

        let updatedLocalMessages: ChatMessage[] = getChatMessages(chatNode.data);
        const isSystemMsg = resolvedMessage === "Workflow reached Chat. Awaiting message...";
        const role = isSystemMsg ? ("system" as const) : ("assistant" as const);
        const dbSource = isSystemMsg ? "System" : senderLabel;

        if (storageNode && hasWritePermission) {
          const dbRecords = getStorageRecords(storageNode.data);
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
            updatedLocalMessages = storageRecords.map((rec) => {
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

        writeToOutputStorage(dbSource, resolvedMessage);

        const envelopeValue = isSystemMsg ? "" : resolvedMessage;
        const envelope: NodeOutputEnvelope = {
          value: envelopeValue,
          metadata: {
            chatHistoryLimit: Number(chatNode.data?.chatHistoryLimit || 0),
            messageCount: updatedLocalMessages.length,
            sender: isSystemMsg ? "System" : senderLabel,
            timestamp: new Date().toISOString(),
          },
          data: {
            messages: updatedLocalMessages,
            latestMessage: envelopeValue,
          },
        };

        updateNodeData(
          chatNode.id,
          setOutputEnvelope({ ...chatNode.data, messages: updatedLocalMessages }, envelope)
        );
      }
    });
  }
}
