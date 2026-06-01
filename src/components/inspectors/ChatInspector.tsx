import { useState } from "react";
import type { InspectorProps } from "./types";
import CollapsibleSection from "./CollapsibleSection";
import InspectorActions from "./InspectorActions";
import { getChatMessages, getStorageRecords } from "@/engine/nodeData";
import { formInputClass } from "@/components/shared/FormField";

export default function ChatInspector({
  node,
  onUpdate,
  runningStartNodeIds,
  onChatSend,
  nodes,
  edges,
  onSaveAsCustom,
  onDeleteNode,
}: InspectorProps) {
  const [chatInput, setChatInput] = useState("");

  const isThisChatRunning = !!runningStartNodeIds?.has(node.id);

  // Find the JSON storage node connected to this Chat's bottom storage handle.
  const storageEdge = edges?.find(
    (e) => e.source === node.id && e.sourceHandle === "storage"
  );
  const connectedStorageNode = storageEdge
    ? nodes?.find((n) => n.id === storageEdge.target && n.type === "jsonStorage")
    : null;

  const storageEdgeType = (storageEdge?.data?.edgeType as string) || "read-write";
  const hasReadPermission = storageEdgeType === "read-only" || storageEdgeType === "read-write";
  const hasWritePermission = storageEdgeType === "write-only" || storageEdgeType === "read-write";

  const dbRecords = getStorageRecords(connectedStorageNode?.data);
  const displayMessages = (connectedStorageNode && hasReadPermission)
    ? dbRecords.map((rec) => {
        const src = (rec.source || "").toLowerCase();
        let role: "user" | "assistant" | "system" = "assistant";
        if (src === "user" || src === "you") {
          role = "user";
        } else if (src === "system") {
          role = "system";
        }
        return { role, content: rec.content || "", sender: rec.source };
      })
    : getChatMessages(node.data);

  const handleSend = () => {
    if (chatInput.trim() && onChatSend) {
      onChatSend(node.id, chatInput.trim());
      setChatInput("");
    }
  };

  const canClearHistory = !(connectedStorageNode && !hasWritePermission);

  const handleClearHistory = () => {
    if (!canClearHistory) return;
    onUpdate(node.id, {
      ...node.data,
      messages: [],
    });
    if (connectedStorageNode && hasWritePermission) {
      onUpdate(connectedStorageNode.id, {
        ...connectedStorageNode.data,
        records: [],
      });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <CollapsibleSection title="Conversation" icon="💬" defaultOpen={true}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3">
            {displayMessages.map((msg, idx) => {
              if (msg.role === "system") {
                return (
                  <div
                    key={idx}
                    className="self-center bg-primary/50 border border-border-subtle/60 px-3 py-1 rounded text-[11px] text-text-secondary italic max-w-[85%] text-center my-1 select-none shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]"
                  >
                    {msg.content}
                  </div>
                );
              }
              return (
                <div key={idx} className={`flex flex-col gap-1 max-w-[90%] ${msg.role === "user" ? "self-end" : "self-start"}`}>
                  <div className={`text-[10px] font-semibold text-text-muted uppercase ${msg.role === "user" ? "text-right text-accent-dim" : ""}`}>{msg.role === "user" ? "You" : (msg.sender || "Agent")}</div>
                  <div className={`px-3 py-2 rounded-md text-[13px] text-text-main leading-relaxed whitespace-pre-wrap wrap-break-word border border-border-subtle ${msg.role === "user" ? "bg-accent-glow border-accent-dim rounded-br-sm" : "bg-input rounded-bl-sm"}`}>{msg.content}</div>
                </div>
              );
            })}
            {displayMessages.length === 0 && (
              <div className="text-text-muted text-xs text-center py-3 select-none">
                No messages yet. Say hello!
              </div>
            )}
          </div>

          <div className="border-t border-border-subtle/60 pt-3 flex flex-col gap-2">
            <textarea
              className={`${formInputClass} min-h-15 resize-none`}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Type a message..."
              rows={2}
              disabled={isThisChatRunning}
            />
            <button
              className={`w-full border border-accent text-accent rounded-md py-2.5 text-sm font-semibold cursor-pointer transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${isThisChatRunning ? "bg-accent text-primary shadow-[0_0_12px_rgba(212,230,0,0.3)]" : "bg-card hover:bg-accent hover:text-primary hover:shadow-[0_0_12px_rgba(212,230,0,0.3)]"}`}
              onClick={handleSend}
              disabled={!chatInput.trim() || isThisChatRunning}
            >
              {isThisChatRunning ? "Sending..." : "Send"}
            </button>
            <button
              className="w-full rounded-md py-2.5 text-sm font-semibold transition-all flex justify-center items-center gap-2 bg-transparent border border-dashed border-border-subtle text-text-secondary enabled:cursor-pointer enabled:hover:border-danger enabled:hover:text-danger enabled:hover:bg-danger/10 enabled:hover:shadow-none disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleClearHistory}
              disabled={!canClearHistory}
              title={canClearHistory ? undefined : "Linked storage is read-only — history can't be cleared from here"}
            >
              Clear History
            </button>
          </div>
        </div>
      </CollapsibleSection>

      <InspectorActions onSaveAsCustom={onSaveAsCustom} onDeleteNode={onDeleteNode} />
    </div>
  );
}
