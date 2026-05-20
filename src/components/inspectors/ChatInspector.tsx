import { useState } from "react";
import type { InspectorProps } from "./types";

export default function ChatInspector({
  node,
  onUpdate,
  isRunning,
  onChatSend
}: InspectorProps) {
  const [chatInput, setChatInput] = useState("");

  const handleSend = () => {
    if (chatInput.trim() && onChatSend) {
      onChatSend(node.id, chatInput.trim());
      setChatInput("");
    }
  };

  return (
    <div className="border-t border-border-subtle pt-4 flex flex-col gap-4 flex-col h-[400px]">
      <div className="text-[11px] uppercase tracking-widest font-bold text-text-muted mb-2">Chat Conversation</div>
      <div className="flex-1 overflow-y-auto bg-primary border border-border-subtle rounded-sm p-3 flex flex-col gap-3 mb-3">
        {((node.data?.messages as any[]) || []).map((msg, idx) => (
          <div key={idx} className={`flex flex-col gap-1 max-w-[90%] ${msg.role === "user" ? "self-end" : "self-start"}`}>
            <div className={`text-[10px] font-semibold text-text-muted uppercase ${msg.role === "user" ? "text-right text-accent-dim" : ""}`}>{msg.role === "user" ? "You" : "Agent"}</div>
            <div className={`bg-card px-3 py-2 rounded-md text-[13px] text-text-main leading-relaxed whitespace-pre-wrap break-words border border-border-subtle ${msg.role === "user" ? "bg-accent-glow border-accent-dim rounded-br-sm" : "bg-input rounded-bl-sm"}`}>{msg.content}</div>
          </div>
        ))}
        {((node.data?.messages as any[]) || []).length === 0 && (
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
          disabled={isRunning}
        />
        <button 
          className={`w-full border border-accent text-accent rounded-md py-2.5 text-sm font-semibold cursor-pointer transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${isRunning ? "bg-accent text-primary shadow-[0_0_12px_rgba(212,230,0,0.3)]" : "bg-card hover:bg-accent hover:text-primary hover:shadow-[0_0_12px_rgba(212,230,0,0.3)]"}`}
          onClick={handleSend}
          disabled={!chatInput.trim() || isRunning}
        >
          {isRunning ? "Sending..." : "Send"}
        </button>
      </div>
      <button
        className="w-full rounded-md py-2.5 text-sm font-semibold cursor-pointer transition-all flex justify-center items-center gap-2 bg-transparent border border-dashed border-border-subtle text-text-secondary hover:border-[#ff6b6b] hover:text-[#ff6b6b] hover:bg-[rgba(255,107,107,0.1)] hover:shadow-none"
        onClick={() =>
          onUpdate(node.id, {
            ...node.data,
            messages: [],
          })
        }
      >
        Clear History
      </button>
    </div>
  );
}
