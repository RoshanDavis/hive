import type { InspectorProps } from "./types";

export default function OllamaInspector({
  node,
  onUpdate
}: InspectorProps) {
  const limitValue = Number(node.data?.chatHistoryLimit || 0);
  const isLimited = limitValue > 0;

  return (
    <div className="border-t border-border-subtle pt-4 flex flex-col gap-4">
      <div className="text-[11px] uppercase tracking-widest font-bold text-text-muted mb-2">Agent Configuration</div>
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Model</label>
        <input
          className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
          type="text"
          value={String(node.data?.model || "")}
          onChange={(e) =>
            onUpdate(node.id, {
              ...node.data,
              model: e.target.value,
            })
          }
          placeholder="e.g. llama3, mistral"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Ollama URL</label>
        <input
          className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
          type="text"
          value={String(node.data?.ollamaUrl || "")}
          onChange={(e) =>
            onUpdate(node.id, {
              ...node.data,
              ollamaUrl: e.target.value,
            })
          }
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">System Prompt</label>
        <textarea
          className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none resize-y min-h-[80px] font-inherit"
          value={String(node.data?.systemPrompt || "")}
          onChange={(e) =>
            onUpdate(node.id, {
              ...node.data,
              systemPrompt: e.target.value,
            })
          }
          placeholder="You are a helpful AI assistant."
          rows={3}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Temperature: {Number(node.data?.temperature || 0.7).toFixed(2)}
        </label>
        <input
          className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={Number(node.data?.temperature || 0.7)}
          onChange={(e) =>
            onUpdate(node.id, {
              ...node.data,
              temperature: parseFloat(e.target.value),
            })
          }
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Max Tokens</label>
        <input
          className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
          type="number"
          value={Number(node.data?.maxTokens || 2048)}
          onChange={(e) =>
            onUpdate(node.id, {
              ...node.data,
              maxTokens: parseInt(e.target.value, 10),
            })
          }
        />
      </div>
      <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Limit Chat History
          </span>
          <button
            onClick={() => {
              onUpdate(node.id, {
                ...node.data,
                chatHistoryLimit: isLimited ? 0 : 10,
              });
            }}
            className={`w-10 h-5.5 rounded-full p-0.5 transition-colors duration-200 outline-none cursor-pointer flex items-center ${
              isLimited ? "bg-[#d4e600]" : "bg-[#2a2a2a]"
            }`}
            style={{ border: isLimited ? "none" : "1px solid #3a3a3a" }}
          >
            <div
              className={`w-4.5 h-4.5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
                isLimited ? "translate-x-4.5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {isLimited && (
          <div className="flex flex-col gap-2 pl-1 animate-[fadeIn_0.15s_ease-out]">
            <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
              History Turn Limit (messages)
            </label>
            <input
              className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
              type="number"
              min="1"
              value={limitValue}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                onUpdate(node.id, {
                  ...node.data,
                  chatHistoryLimit: isNaN(val) || val <= 0 ? 1 : val,
                });
              }}
              placeholder="e.g. 10"
            />
          </div>
        )}
      </div>

      {/* Last Response (Premium visual feedback) */}
      {!!node.data?.lastResponse && (
        <div className="flex flex-col gap-2 mt-2 border-t border-border-subtle pt-4">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Last Response</label>
            <button
              onClick={() => onUpdate(node.id, { ...node.data, lastResponse: "" })}
              className="text-[10px] text-text-muted hover:text-[#ff6b6b] transition-colors cursor-pointer border-none bg-transparent"
              title="Clear response"
            >
              Clear
            </button>
          </div>
          <div className="w-full bg-primary border border-border-subtle rounded-md p-3 text-xs text-text-main leading-relaxed font-mono whitespace-pre-wrap max-h-[160px] overflow-y-auto select-text">
            {String(node.data.lastResponse)}
          </div>
        </div>
      )}
    </div>
  );
}
