import { useState } from "react";
import { NODE_REGISTRY, type NodeDefinition } from "../nodes/types";
import type { Node } from "@xyflow/react";

// ─── Props ───────────────────────────────────────────────────
interface InspectorPanelProps {
  selectedNode: Node | null;
  onAddNode: (definition: NodeDefinition) => void;
  onUpdateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  onRunWorkflow: () => void;
  onChatSend?: (nodeId: string, text: string) => void;
  isRunning: boolean;
}

// ─── Inspector Panel ─────────────────────────────────────────
export default function InspectorPanel({
  selectedNode,
  onAddNode,
  onUpdateNodeData,
  onRunWorkflow,
  onChatSend,
  isRunning,
}: InspectorPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter the node registry by search (only by label to prevent single-character matches on descriptions)
  const filteredNodes = NODE_REGISTRY.filter(
    (def) => def.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ─── Node Details Mode ───────────────────────────────────
  if (selectedNode) {
    return (
      <div className="w-[320px] bg-sidebar border-l border-border-subtle flex flex-col z-10 shrink-0" id="inspector-panel">
        <div className="p-4 border-b border-border-subtle bg-card flex flex-col gap-1">
          <h2 className="text-base font-semibold m-0 text-text-main flex items-center gap-2">
            {selectedNode.type === "trigger" ? "⚡" : ""}
            {selectedNode.type === "notify" ? "🔔" : ""}
            {selectedNode.type === "ollama" ? "🤖" : ""}
            {selectedNode.type === "chat" ? "💬" : ""}
            {selectedNode.type === "output" ? "📤" : ""}
            {" "}
            {String(selectedNode.data?.label || selectedNode.type)}
          </h2>
          <span className="text-[10px] uppercase tracking-widest font-bold text-accent bg-accent-glow self-start px-2 py-0.5 rounded-sm">{selectedNode.type}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
          {/* Common fields */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Label</label>
            <input
              className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
              type="text"
              value={String(selectedNode.data?.label || "")}
              onChange={(e) =>
                onUpdateNodeData(selectedNode.id, {
                  ...selectedNode.data,
                  label: e.target.value,
                })
              }
            />
          </div>

          {/* Dynamic Component Rendering based on Registry */}
          {(() => {
            const def = NODE_REGISTRY.find(d => d.type === selectedNode.type);
            const Inspector = def?.inspector;
            if (Inspector) {
              return (
                <Inspector
                  node={selectedNode}
                  onUpdate={onUpdateNodeData}
                  isRunning={isRunning}
                  onRun={onRunWorkflow}
                  onChatSend={onChatSend}
                />
              );
            }
            return null;
          })()}

          {/* Position info */}
          <div className="border-t border-border-subtle pt-4 flex flex-col gap-2">
            <div className="text-[11px] uppercase tracking-widest font-bold text-text-muted mb-1">Position</div>
            <div className="flex gap-4 text-sm text-text-main font-mono">
              <span>X: {Math.round(selectedNode.position?.x || 0)}</span>
              <span>Y: {Math.round(selectedNode.position?.y || 0)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Add Node Mode ───────────────────────────────────────
  return (
    <div className="w-[320px] bg-sidebar border-l border-border-subtle flex flex-col z-10 shrink-0" id="inspector-panel">
      <div className="p-4 border-b border-border-subtle bg-card flex flex-col gap-1">
        <h2 className="text-base font-semibold m-0 text-text-main flex items-center gap-2">Add Node</h2>
        <span className="text-[10px] uppercase tracking-widest font-bold text-accent bg-accent-glow self-start px-2 py-0.5 rounded-sm">Palette</span>
      </div>

      <div className="p-4 border-b border-border-subtle bg-primary">
        <input
          className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
          type="text"
          placeholder="Search nodes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
        {filteredNodes.length > 0 ? (
          filteredNodes.map((def) => (
            <div
              key={def.type}
              className="bg-card border border-border-card rounded-lg p-4 cursor-pointer transition-all hover:bg-card-hover hover:border-accent-dim hover:-translate-y-[2px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
              onClick={() => onAddNode(def)}
              id={`add-node-${def.type}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{def.icon}</span>
                <span className="font-semibold text-text-main">{def.label}</span>
              </div>
              <div className="text-xs text-text-muted leading-relaxed">
                {def.description}
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 text-text-muted gap-2 mt-8">
            <span className="text-2xl opacity-50">🔍</span>
            <span className="text-sm">
              No nodes match "{searchQuery}"
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
