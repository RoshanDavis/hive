import { useState, useRef, useEffect } from "react";
import type { InspectorProps } from "./types";

export default function ChatInspector({
  node,
  onUpdate,
  runningStartNodeIds,
  onChatSend,
  nodes,
  edges
}: InspectorProps) {
  const [chatInput, setChatInput] = useState("");
  const [visibleCount, setVisibleCount] = useState(5);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const prevMessagesLength = useRef(0);

  // Check if this specific ChatNode is currently executing its workflow
  const isThisChatRunning = !!runningStartNodeIds?.has(node.id);

  // Find connected JSON storage node specifically connected to the Chat node's bottom "storage" handle
  const storageEdge = edges?.find(
    (e) => e.source === node.id && e.sourceHandle === "storage"
  );
  const connectedStorageNode = storageEdge
    ? nodes?.find((n) => n.id === storageEdge.target && n.type === "jsonStorage")
    : null;

  const storageEdgeType = (storageEdge?.data?.edgeType as string) || "read-write";
  const hasReadPermission = storageEdgeType === "read-only" || storageEdgeType === "read-write";
  const hasWritePermission = storageEdgeType === "write-only" || storageEdgeType === "read-write";

  // Map storage records to chat messages if connected and read permission is granted, otherwise fallback to local messages
  const dbRecords = (connectedStorageNode?.data?.records as any[]) || [];
  const displayMessages = (connectedStorageNode && hasReadPermission)
    ? dbRecords.map((rec: any) => {
        const src = (rec.source || "").toLowerCase();
        let role: "user" | "assistant" | "system" = "assistant";
        if (src === "user" || src === "you") {
          role = "user";
        } else if (src === "system") {
          role = "system";
        }
        return { role, content: rec.content || "", sender: rec.source };
      })
    : (node.data?.messages as any[]) || [];

  const slicedMessages = displayMessages.slice(-visibleCount);
  const hasMore = displayMessages.length > visibleCount;

  // Auto-scroll to bottom on initial load or when a new message is appended
  useEffect(() => {
    if (chatContainerRef.current) {
      if (displayMessages.length > prevMessagesLength.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    }
    prevMessagesLength.current = displayMessages.length;
  }, [displayMessages.length]);

  // Initial scroll to bottom on mount
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    // Check if scrolled near the top and there are older messages to load
    if (target.scrollTop === 0 && hasMore) {
      const previousScrollHeight = target.scrollHeight;
      setVisibleCount((prev) => {
        const nextCount = Math.min(prev + 5, displayMessages.length);
        
        // After DOM updates, restore scroll position relative to previous scrollHeight
        setTimeout(() => {
          if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop =
              chatContainerRef.current.scrollHeight - previousScrollHeight;
          }
        }, 0);
        
        return nextCount;
      });
    }
  };

  const handleSend = () => {
    if (chatInput.trim() && onChatSend) {
      onChatSend(node.id, chatInput.trim());
      setChatInput("");
    }
  };

  // When read-only storage drives the view, the displayed messages come from records
  // this node can't write to, so clearing local messages would do nothing visible.
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
    setVisibleCount(5);
  };

  return (
    <div className="border-t border-border-subtle pt-4 flex flex-col gap-4 h-[calc(100vh-280px)] min-h-[380px]">
      <div className="flex justify-between items-center mb-1">
        <div className="text-[11px] uppercase tracking-widest font-bold text-text-muted">Chat Conversation</div>
        {connectedStorageNode && (
          <div className="text-[9px] font-semibold text-[#38bdf8] bg-[#38bdf8]/10 px-2 py-0.5 rounded flex items-center gap-1 border border-[#38bdf8]/20 select-none">
            <span>💾</span>
            <span>
              Linked: {String(connectedStorageNode.data?.label || "Storage")} (
              {storageEdgeType === "read-write"
                ? "Sync"
                : storageEdgeType === "read-only"
                ? "Read-Only"
                : "Write-Only"}
              )
            </span>
          </div>
        )}
      </div>

      <div
        ref={chatContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-primary border border-border-subtle rounded-sm p-3 flex flex-col gap-3 mb-3 scroll-smooth"
      >
        {hasMore && (
          <div className="text-[10px] text-text-muted text-center py-1 select-none animate-pulse">
            ↑ Scroll up to load older messages ({displayMessages.length - visibleCount} more)
          </div>
        )}
        {slicedMessages.map((msg, idx) => {
          if (msg.role === "system") {
            return (
              <div
                key={idx}
                className="self-center bg-black/35 border border-border-subtle/60 px-3 py-1 rounded text-[11px] text-text-secondary italic max-w-[85%] text-center my-1 select-none shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]"
              >
                {msg.content}
              </div>
            );
          }
          return (
            <div key={idx} className={`flex flex-col gap-1 max-w-[90%] ${msg.role === "user" ? "self-end" : "self-start"}`}>
              <div className={`text-[10px] font-semibold text-text-muted uppercase ${msg.role === "user" ? "text-right text-accent-dim" : ""}`}>{msg.role === "user" ? "You" : (msg.sender || "Agent")}</div>
              <div className={`bg-card px-3 py-2 rounded-md text-[13px] text-text-main leading-relaxed whitespace-pre-wrap break-words border border-border-subtle ${msg.role === "user" ? "bg-accent-glow border-accent-dim rounded-br-sm" : "bg-input rounded-bl-sm"}`}>{msg.content}</div>
            </div>
          );
        })}
        {displayMessages.length === 0 && (
          <div className="text-text-muted text-xs text-center mt-5">No messages yet. Say hello!</div>
        )}
      </div>
      
      <div className="flex flex-col gap-2">
        <textarea
          className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none min-h-[60px] resize-none"
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
      </div>
      <button
        className="w-full rounded-md py-2.5 text-sm font-semibold transition-all flex justify-center items-center gap-2 bg-transparent border border-dashed border-border-subtle text-text-secondary enabled:cursor-pointer enabled:hover:border-[#ff6b6b] enabled:hover:text-[#ff6b6b] enabled:hover:bg-[rgba(255,107,107,0.1)] enabled:hover:shadow-none disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={handleClearHistory}
        disabled={!canClearHistory}
        title={canClearHistory ? undefined : "Linked storage is read-only — history can't be cleared from here"}
      >
        Clear History
      </button>
    </div>
  );
}
