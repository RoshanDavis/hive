import { useState } from "react";
import { storage, type ConcurrencySettings } from "@/services/storage";

interface WorkspaceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function WorkspaceSettingsModal({
  isOpen,
  onClose,
  showToast
}: WorkspaceSettingsModalProps) {
  const [settings, setSettings] = useState<ConcurrencySettings>(() =>
    storage.getConcurrencySettings()
  );

  if (!isOpen) return null;

  const handleToggle = (nodeType: string) => {
    setSettings((prev) => ({
      ...prev,
      [nodeType]: {
        ...prev[nodeType],
        enabled: !prev[nodeType].enabled
      }
    }));
  };

  const handleLimitChange = (nodeType: string, limit: number) => {
    setSettings((prev) => ({
      ...prev,
      [nodeType]: {
        ...prev[nodeType],
        limit: Math.max(1, limit)
      }
    }));
  };

  const handleSave = () => {
    storage.setConcurrencySettings(settings);
    showToast("Concurrency settings saved successfully ✓", "success");
    onClose();
  };

  // Human-readable labels and icons for each node type
  const nodeInfo: Record<string, { label: string; icon: string }> = {
    ollama: { label: "Ollama Inference", icon: "🤖" },
    chat: { label: "Chat Agent Panel", icon: "💬" },
    notify: { label: "OS Notification", icon: "🔔" },
    output: { label: "Output Inspector", icon: "📤" },
    trigger: { label: "Workflow Trigger", icon: "⚡" },
    jsonStorage: { label: "JSON File Storage", icon: "💾" }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050505]/75 backdrop-blur-md animate-[fadeIn_0.2s_ease-out]">
      {/* Backdrop closer */}
      <div className="absolute inset-0 cursor-default" onClick={onClose} />

      {/* Modal Container */}
      <div className="relative w-full max-w-md bg-card border border-border-card rounded-xl shadow-2xl p-6 flex flex-col gap-6 z-10 select-none overflow-hidden max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle pb-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚙️</span>
            <h2 className="text-lg font-bold text-text-main">Workspace Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-main transition-colors text-sm font-semibold select-none cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Section - Concurrency */}
        <div className="flex flex-col gap-4 overflow-y-auto pr-1">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-1">
              Concurrency & Hardware Limits
            </h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Limit concurrent executions of node operations to prevent memory overload and optimize inference on your local hardware.
            </p>
          </div>

          <div className="flex flex-col gap-3.5 mt-2">
            {Object.entries(settings).map(([nodeType, config]) => {
              const info = nodeInfo[nodeType] || { label: nodeType, icon: "⚙️" };
              return (
                <div
                  key={nodeType}
                  className="bg-primary/45 border border-border-subtle rounded-lg p-3.5 flex flex-col gap-3 transition-colors hover:border-accent-dim"
                >
                  <div className="flex items-center justify-between">
                    {/* Label and Icon */}
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">{info.icon}</span>
                      <span className="text-sm font-semibold text-text-main">{info.label}</span>
                    </div>

                    {/* Toggle Switch */}
                    <button
                      onClick={() => handleToggle(nodeType)}
                      className={`w-9.5 h-5.5 rounded-full p-0.5 transition-colors duration-200 outline-none cursor-pointer flex items-center ${
                        config.enabled ? "bg-[#d4e600]" : "bg-[#2a2a2a]"
                      }`}
                      style={{ border: config.enabled ? "none" : "1px solid #3c3c3c" }}
                    >
                      <div
                        className={`w-4.5 h-4.5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
                          config.enabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Limit Control - Slider & Counter */}
                  {config.enabled && (
                    <div className="flex flex-col gap-2.5 pl-8 animate-[fadeIn_0.15s_ease-out]">
                      <div className="flex justify-between items-center text-[11px] font-semibold text-text-secondary">
                        <span className="uppercase tracking-wider">Max Parallel Executions</span>
                        <span className="text-accent bg-accent-glow font-bold px-2 py-0.5 rounded-md">
                          {config.limit} task{config.limit > 1 ? "s" : ""}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="1"
                          value={config.limit}
                          onChange={(e) => handleLimitChange(nodeType, parseInt(e.target.value, 10))}
                          className="flex-1 accent-[#d4e600] h-1 bg-border-subtle rounded-lg cursor-pointer"
                        />
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={config.limit}
                          onChange={(e) => handleLimitChange(nodeType, parseInt(e.target.value, 10) || 1)}
                          className="w-12 bg-input border border-border-subtle rounded-md py-0.5 text-center text-xs text-text-main outline-none focus:border-accent-dim"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-border-subtle pt-4 mt-1 select-none">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border-subtle rounded-lg text-xs font-semibold text-text-secondary hover:text-text-main hover:bg-card-hover transition-colors cursor-pointer select-none"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-[#d4e600] hover:bg-[#b0bf00] active:scale-[0.98] text-[#0a0a0a] font-bold text-xs rounded-lg transition-all shadow-[0_4px_12px_rgba(212,230,0,0.15)] cursor-pointer select-none"
          >
            Save Changes
          </button>
        </div>

      </div>
    </div>
  );
}
