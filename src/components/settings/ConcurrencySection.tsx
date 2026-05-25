import { useState } from "react";
import { type ConcurrencySettings, type ConcurrencyConfig } from "@/services/storage";
import CollapsibleSection from "../inspectors/CollapsibleSection";
import NodeSelectorPopup from "./NodeSelectorPopup";
import { NODE_REGISTRY } from "@/nodes/registry";

interface ConcurrencySectionProps {
  settings: ConcurrencySettings;
  onUpdate: (settings: ConcurrencySettings) => void;
}

function getNodeInfo(type: string) {
  const reg = NODE_REGISTRY.find(
    (n) => n.type === type || (type === "output" && n.type === "outputNode")
  );
  if (reg) return { label: reg.label, icon: reg.icon };
  return { label: type, icon: "⚙️" };
}

interface NodeConcurrencyCardProps {
  nodeType: string;
  config: ConcurrencyConfig;
  onLimitChange: (limit: number) => void;
  onRemove: () => void;
}

function NodeConcurrencyCard({
  nodeType,
  config,
  onLimitChange,
  onRemove,
}: NodeConcurrencyCardProps) {
  const info = getNodeInfo(nodeType);

  return (
    <div className="concurrency-card relative group animate-[fadeIn_0.2s_ease-out]">
      {/* Remove limit button (✕) */}
      <button
        onClick={onRemove}
        className="concurrency-card-remove"
        title={`Remove limit for ${info.label}`}
      >
        ✕
      </button>

      {/* Node Icon */}
      <span className="text-xl select-none group-hover:scale-110 transition-transform duration-200">
        {info.icon}
      </span>

      {/* Node Label */}
      <span className="text-[10px] font-bold text-text-muted text-center tracking-wide truncate max-w-full uppercase mt-1">
        {info.label}
      </span>

      {/* Limit Input Container */}
      <div className="mt-2 flex items-center justify-center gap-1 bg-[#0a0a0a] border border-[#2a2a2a] rounded-md px-1 py-0.5 w-full max-w-[68px] focus-within:border-accent-dim transition-colors">
        <span className="text-[8px] text-text-muted font-bold select-none uppercase">Max</span>
        <input
          type="number"
          min="1"
          max="99"
          value={config.limit}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            onLimitChange(isNaN(val) ? 1 : val);
          }}
          className="concurrency-card-input"
        />
      </div>
    </div>
  );
}

export default function ConcurrencySection({ settings, onUpdate }: ConcurrencySectionProps) {
  const [isPopupOpen, setIsPopupOpen] = useState(false);

  const handleLimitChange = (nodeType: string, limit: number) => {
    onUpdate({
      ...settings,
      [nodeType]: { ...settings[nodeType], limit: Math.max(1, limit) },
    });
  };

  const handleRemove = (nodeType: string) => {
    onUpdate({
      ...settings,
      [nodeType]: { ...settings[nodeType], enabled: false },
    });
  };

  const handleAddNode = (nodeType: string) => {
    onUpdate({
      ...settings,
      [nodeType]: { enabled: true, limit: settings[nodeType]?.limit || 2 },
    });
  };

  // Only display nodes that are enabled
  const activeEntries = Object.entries(settings).filter(([_, config]) => config?.enabled);
  const activeNodeTypes = activeEntries.map(([type]) => type);

  return (
    <CollapsibleSection
      title="Concurrency Limits"
      icon="⚡"
      defaultOpen={true}
      badge={activeEntries.length > 0 ? `${activeEntries.length} active` : undefined}
    >
      <p className="text-[11px] text-text-muted leading-relaxed mb-3.5">
        Configure concurrent execution limits per node type to manage system load and hardware resources.
      </p>

      <div className="concurrency-grid">
        {activeEntries.map(([nodeType, config]) => (
          <NodeConcurrencyCard
            key={nodeType}
            nodeType={nodeType}
            config={config}
            onLimitChange={(limit) => handleLimitChange(nodeType, limit)}
            onRemove={() => handleRemove(nodeType)}
          />
        ))}

        {/* Dashed plus button to add nodes */}
        <button
          onClick={() => setIsPopupOpen(true)}
          className="concurrency-add-card group"
          title="Add concurrency limit to a node"
        >
          <span className="text-xl font-light text-text-muted group-hover:text-text-main transition-colors">
            +
          </span>
          <span className="text-[8px] font-bold text-text-muted group-hover:text-text-main transition-colors uppercase tracking-wider mt-0.5">
            Add Node
          </span>
        </button>
      </div>

      <NodeSelectorPopup
        isOpen={isPopupOpen}
        onClose={() => setIsPopupOpen(false)}
        onSelect={handleAddNode}
        activeNodeTypes={activeNodeTypes}
      />
    </CollapsibleSection>
  );
}
