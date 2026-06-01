import { concurrencyGovernor } from "@/services/concurrency";
import type { ExecutionContext, NodeExecutor, NodeOutputEnvelope } from "./types";
import { getUpstreamNodeData, getUpstreamNodes } from "./utils";
import {
  getChatMessages,
  getChatStorageEdges,
  getLastInput,
  getMergedChatRecords,
  getStorageRecords,
  recordToChatMessage,
  setOutputEnvelope,
} from "./nodeData";
import type { ChatMessage, JSONStorageRecord } from "@/nodes/types";

export class ChatExecutor implements NodeExecutor {
  async execute(context: ExecutionContext): Promise<void> {
    const { node: chatNode, nodes, edges, updateNodeData, chatInput, visited } = context;
    await concurrencyGovernor.enqueue("general", async () => {
      // All chat → jsonStorage edges, decorated with parsed permissions and
      // sorted deterministically. Bottom storage handle defaults to
      // read-write; non-storage handles are locked write-only by
      // connectivity rules. Per-edge permissions in the inspector are the
      // single lever the user has — there's no privileged "primary" storage.
      const storageEdges = getChatStorageEdges(chatNode.id, nodes, edges);
      const anyReadEnabled = storageEdges.some((se) => se.hasRead);

      // One batch id per chat turn. Every record written by this fan-out
      // carries it, so the merged-read collapses them on the way back into
      // the conversation view (without false-collapsing records the user
      // edited manually in a storage inspector).
      const writeBatchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Fan-out write helper. Walks every storage edge with write permission
      // and appends the same record. Non-atomic by design — a cancel
      // mid-loop leaves some storages updated and others not, consistent
      // with how the rest of the engine treats `updateNodeData` side
      // effects. Edges are pre-sorted so partial-failure order is
      // reproducible.
      const fanOutWrite = (source: string, content: string): void => {
        const nowIso = new Date().toISOString();
        const idBase = Date.now().toString();
        const written = new Set<string>();
        let writeIndex = 0;
        for (const se of storageEdges) {
          if (!se.hasWrite) continue;
          // Dedupe by target: if a chat has two edges to the same storage
          // (e.g. bottom handle + right handle), one record per storage.
          if (written.has(se.target.id)) continue;
          written.add(se.target.id);
          // Re-find the target from `nodes` so we see the previous write in
          // this fan-out (updateNodeData mutates currentNodes in-place).
          const fresh = nodes.find((n) => n.id === se.target.id) ?? se.target;
          const dbRecords = getStorageRecords(fresh.data);
          const newRecord: JSONStorageRecord = {
            id: `${idBase}-${writeIndex++}`,
            timestamp: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
            source,
            content,
            createdAt: nowIso,
            writeBatchId,
          };
          updateNodeData(fresh.id, {
            ...fresh.data,
            records: [...dbRecords, newRecord],
          });
        }
      };

      // After a fan-out write, rebuild the chat's local message list from
      // the merged view of all read-enabled storages. Used when at least
      // one edge has read permission; otherwise the chat keeps its own
      // independent message list.
      const syncFromMergedRead = (): ChatMessage[] =>
        getMergedChatRecords(chatNode.id, nodes, edges).map(recordToChatMessage);

      // A write reaches the merged-read view only when some storage target
      // has BOTH a write-enabled and a read-enabled edge from this chat
      // (i.e. the read sources and write sinks overlap at the node level).
      // If they're disjoint — e.g. one read-only "source of truth" storage
      // and one write-only "archive" storage — the message we just wrote
      // lands in the archive but never appears in the merged view, so the
      // chat would drop the user's own message. We detect that and append
      // explicitly below.
      const writeTargetIds = new Set(
        storageEdges.filter((se) => se.hasWrite).map((se) => se.target.id)
      );
      const writeReachesReadSource = storageEdges.some(
        (se) => se.hasRead && writeTargetIds.has(se.target.id)
      );

      if (chatInput !== undefined && chatInput !== null) {
        // ─── Case A: User sent a message (Input Mode) ───
        fanOutWrite("User", chatInput);

        let updatedLocalMessages: ChatMessage[];
        if (anyReadEnabled) {
          updatedLocalMessages = syncFromMergedRead();
          if (!writeReachesReadSource) {
            // Writes went only to storages outside the read set (or no
            // writes happened at all) — append so the chat still shows
            // what the user just sent.
            updatedLocalMessages = [
              ...updatedLocalMessages,
              { role: "user", content: chatInput, sender: "User" },
            ];
          }
        } else {
          updatedLocalMessages = [
            ...getChatMessages(chatNode.data),
            { role: "user" as const, content: chatInput, sender: "You" },
          ];
        }

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
        // bi-dir edges but skips dedicated storage handles so a Chat ⇄
        // jsonStorage edge isn't mistaken for an input source.
        const upstreamNodes = getUpstreamNodes(chatNode.id, edges, nodes, {
          visited,
          includeBiDirectional: true,
          excludeStorageHandles: true,
        });
        const hasUpstream = upstreamNodes.length > 0;

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

          updateNodeData(chatNode.id, {
            ...chatNode.data,
            lastInputText: resolvedMessage,
            lastInputSender: senderLabel,
          });
        }

        if (!resolvedMessage) {
          if (hasUpstream) {
            resolvedMessage = "Workflow reached Chat. Awaiting message...";
          } else {
            return;
          }
        }

        const isSystemMsg = resolvedMessage === "Workflow reached Chat. Awaiting message...";
        const dbSource = isSystemMsg ? "System" : senderLabel;
        const role: ChatMessage["role"] = isSystemMsg ? "system" : "assistant";

        fanOutWrite(dbSource, resolvedMessage);

        let updatedLocalMessages: ChatMessage[];
        if (anyReadEnabled) {
          updatedLocalMessages = syncFromMergedRead();
          if (!writeReachesReadSource) {
            // Same disjoint-storage edge case as Case A — the inbound
            // message landed in a write-only sink that no read source
            // observes, so append explicitly.
            updatedLocalMessages = [
              ...updatedLocalMessages,
              { role, content: resolvedMessage, sender: isSystemMsg ? undefined : senderLabel },
            ];
          }
        } else {
          updatedLocalMessages = [
            ...getChatMessages(chatNode.data),
            { role, content: resolvedMessage, sender: isSystemMsg ? undefined : senderLabel },
          ];
        }

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
