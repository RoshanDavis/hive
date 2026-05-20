import type { InspectorProps } from "./types";

export default function OllamaInspector({
  node,
  onUpdate
}: InspectorProps) {
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
    </div>
  );
}
