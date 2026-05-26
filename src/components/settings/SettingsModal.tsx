import { useState, useEffect } from "react";
import { storage, type ConcurrencySettings } from "@/services/storage";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function SettingsModal({ isOpen, onClose, showToast }: SettingsModalProps) {
  if (!isOpen) return null;

  // Concurrency & Resource Pool State
  const [localEnabled, setLocalEnabled] = useState(true);
  const [localLimit, setLocalLimit] = useState(1);

  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [cloudLimit, setCloudLimit] = useState(10);

  const [generalEnabled, setGeneralEnabled] = useState(false);
  const [generalLimit, setGeneralLimit] = useState(2);

  // Local Endpoint Identifiers (Glob Wildcard patterns)
  const [patterns, setPatterns] = useState<string[]>([]);
  const [newPattern, setNewPattern] = useState("");

  // UI Collapsible Dropdown State
  const [showConcurrencyPools, setShowConcurrencyPools] = useState(true);
  const [showPatterns, setShowPatterns] = useState(false);

  // Load settings on open
  useEffect(() => {
    const settings = storage.getConcurrencySettings();
    setLocalEnabled(settings.local.enabled);
    setLocalLimit(settings.local.limit);
    setCloudEnabled(settings.cloud.enabled);
    setCloudLimit(settings.cloud.limit);
    setGeneralEnabled(settings.general.enabled);
    setGeneralLimit(settings.general.limit);
    setPatterns(settings.localPatterns || ["*localhost*", "*127.0.0.1*", "*[::1]*"]);
  }, [isOpen]);

  const handleSave = () => {
    const updatedSettings: ConcurrencySettings = {
      local: { enabled: localEnabled, limit: Math.max(1, localLimit) },
      cloud: { enabled: cloudEnabled, limit: Math.max(1, cloudLimit) },
      general: { enabled: generalEnabled, limit: Math.max(1, generalLimit) },
      localPatterns: patterns.filter(Boolean)
    };
    storage.setConcurrencySettings(updatedSettings);
    showToast("Resource settings saved ✓", "success");
    onClose();
  };

  const handleAddPattern = () => {
    const trimmed = newPattern.trim().toLowerCase();
    if (!trimmed) return;
    
    if (patterns.includes(trimmed)) {
      showToast("Pattern already exists", "info");
      return;
    }

    setPatterns([...patterns, trimmed]);
    setNewPattern("");
  };

  const handleRemovePattern = (patternToRemove: string) => {
    setPatterns(patterns.filter(p => p !== patternToRemove));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-[#050505]/75 backdrop-blur-md animate-[fadeIn_0.2s_ease-out]">
      <div className="absolute inset-0 cursor-default" onClick={onClose} />

      <div className="settings-modal-container max-w-4xl w-[92vw] h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle pb-4">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">⚙️</span>
            <div>
              <h2 className="text-lg font-bold text-text-main">Settings</h2>
              <p className="text-[11px] text-text-muted mt-0.5">Configure system concurrency, resource limits, and model routing rules</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-main hover:bg-card-hover transition-colors text-sm cursor-pointer border-none bg-transparent"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Settings Panel */}
        <div className="flex-1 overflow-y-auto pr-1 py-4 flex flex-col gap-6 text-left select-none scrollbar-thin">
          
          {/* Section: Concurrency Pools */}
          <div className="flex flex-col gap-4">
            {/* Collapsible Section Header */}
            <div className="flex flex-col gap-0.5 border-b border-border-subtle pb-2">
              <button
                type="button"
                onClick={() => setShowConcurrencyPools(!showConcurrencyPools)}
                className="flex items-center gap-1.5 text-sm font-bold text-text-main hover:text-accent transition-colors bg-transparent border-none cursor-pointer p-0 select-none outline-none"
              >
                <span>{showConcurrencyPools ? "▼" : "▶"} Execution Concurrency Pools</span>
              </button>
              <p className="text-[10px] text-text-muted mt-1">Control active parallelism across different model environments to protect memory</p>
            </div>

            {showConcurrencyPools && (
              <div className="flex flex-col gap-4 animate-[fadeIn_0.15s_ease-out]">
                
                {/* Row 1: Local Model Pool */}
                <div className="flex flex-col gap-4 p-4 bg-secondary/30 rounded-xl border border-border-subtle hover:border-accent-dim/20 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex flex-col gap-1 max-w-md">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-text-main">Local Model Pool</span>
                        <span className="px-2 py-0.5 text-[9px] font-bold bg-accent-glow border border-accent/25 text-accent rounded-full">VRAM/RAM Heavy</span>
                      </div>
                      <p className="text-[10.5px] text-text-secondary leading-normal">
                        Limits local models (Ollama, LM Studio) running concurrently. A limit of <strong>1</strong> is highly recommended for laptops to prevent memory thrashing and system-level crashes.
                      </p>
                    </div>
                    <div className="flex items-center gap-4 self-end md:self-center">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-text-secondary">Enable Limit</span>
                        <button
                          onClick={() => setLocalEnabled(!localEnabled)}
                          className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 border-none cursor-pointer flex items-center ${localEnabled ? 'bg-accent' : 'bg-input'}`}
                        >
                          <div className={`w-4 h-4 rounded-full bg-[#0a0a0a] shadow-md transform duration-200 ${localEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>
                      {localEnabled && (
                        <div className="flex items-center gap-1.5 bg-input border border-border-subtle rounded-lg px-2 py-1">
                          <span className="text-[10px] text-text-secondary">Max:</span>
                          <input
                            type="number"
                            min="1"
                            max="16"
                            value={localLimit}
                            onChange={(e) => setLocalLimit(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-8 bg-transparent border-none text-center text-xs text-text-main font-bold outline-none"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Conditional local patterns collapsible list inside card */}
                  {localEnabled && (
                    <div className="border-t border-border-subtle/50 pt-3 mt-1 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => setShowPatterns(!showPatterns)}
                        className="flex items-center gap-1.5 text-[10.5px] font-bold text-accent hover:text-accent-dim transition-colors bg-transparent border-none cursor-pointer p-0 self-start select-none outline-none"
                      >
                        <span>{showPatterns ? "▼" : "▶"} Configure Local Endpoint Rules (Glob Wildcards)</span>
                      </button>
                      
                      {showPatterns && (
                        <div className="flex flex-col gap-3 mt-1.5 p-3.5 bg-input/40 border border-border-subtle rounded-lg animate-[fadeIn_0.15s_ease-out]">
                          {/* input */}
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Enter wildcard pattern (e.g. *localhost*, *192.168.1.*)"
                              value={newPattern}
                              onChange={(e) => setNewPattern(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleAddPattern();
                                }
                              }}
                              className="flex-1 bg-input border border-border-subtle rounded-md px-2.5 py-1.5 text-[11px] text-text-main font-semibold outline-none focus:border-accent-dim/40 transition-colors"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddPattern()}
                              className="px-3 py-1.5 bg-[#d4e600] hover:bg-[#b0bf00] text-[#0a0a0a] font-bold text-[10px] rounded-md transition-colors cursor-pointer border-none"
                            >
                              + Add
                            </button>
                          </div>

                          {/* tags list */}
                          <div className="flex flex-wrap gap-1.5 min-h-[30px] p-2 bg-input/20 border border-border-subtle rounded-md">
                            {patterns.length === 0 ? (
                              <span className="text-[9.5px] text-text-muted italic flex items-center px-1">No custom patterns. All hosts run in Cloud pool.</span>
                            ) : (
                              patterns.map((pat) => (
                                <div
                                  key={pat}
                                  className="flex items-center gap-1 bg-[#252525] border border-border-card rounded-md px-1.5 py-0.5 text-[10px] font-bold text-text-secondary hover:text-text-main hover:border-accent-dim/30 transition-all select-none"
                                >
                                  <span className="font-mono text-[9px] text-accent/90">{pat}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePattern(pat)}
                                    className="text-text-muted hover:text-red-400 bg-transparent border-none text-[8px] cursor-pointer pl-0.5"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))
                            )}
                          </div>

                          <div className="text-[9.5px] text-text-muted leading-relaxed pl-2 border-l-2 border-accent-dim/40 py-0.5">
                            💡 <strong>Tip:</strong> Matching is case-insensitive. By default, anything pointed to local loopbacks (e.g. <code>*localhost*</code>) respects local VRAM locks.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Row 2: Cloud Model Pool */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-secondary/30 rounded-xl border border-border-subtle hover:border-accent-dim/20 transition-colors">
                  <div className="flex flex-col gap-1 max-w-md">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-text-main">Cloud Model Pool</span>
                      <span className="px-2 py-0.5 text-[9px] font-bold bg-[#60a5fa]/10 border border-[#60a5fa]/25 text-[#60a5fa] rounded-full">Remote APIs</span>
                    </div>
                    <p className="text-[10.5px] text-text-secondary leading-normal">
                      Controls parallel HTTP connections to cloud models (OpenAI, Anthropic, Google). Since cloud calls run on remote servers, limits are only useful for rate-limiting.
                    </p>
                  </div>
                  <div className="flex items-center gap-4 self-end md:self-center">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-text-secondary">Enable Limit</span>
                      <button
                        onClick={() => setCloudEnabled(!cloudEnabled)}
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 border-none cursor-pointer flex items-center ${cloudEnabled ? 'bg-accent' : 'bg-input'}`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-[#0a0a0a] shadow-md transform duration-200 ${cloudEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
                    {cloudEnabled && (
                      <div className="flex items-center gap-1.5 bg-input border border-border-subtle rounded-lg px-2 py-1">
                        <span className="text-[10px] text-text-secondary">Max:</span>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={cloudLimit}
                          onChange={(e) => setCloudLimit(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-10 bg-transparent border-none text-center text-xs text-text-main font-bold outline-none"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Row 3: General Tasks */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-secondary/30 rounded-xl border border-border-subtle hover:border-accent-dim/20 transition-colors">
                  <div className="flex flex-col gap-1 max-w-md">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-text-main">General Tasks</span>
                      <span className="px-2 py-0.5 text-[9px] font-bold bg-[#34d399]/10 border border-[#34d399]/25 text-[#34d399] rounded-full">Utility Nodes</span>
                    </div>
                    <p className="text-[10.5px] text-text-secondary leading-normal">
                      Concurrency for instant workflows like notifications, local workspace state saves, and JSON database updates. Typically runs without limits to prevent blocking execution.
                    </p>
                  </div>
                  <div className="flex items-center gap-4 self-end md:self-center">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-text-secondary">Enable Limit</span>
                      <button
                        onClick={() => setGeneralEnabled(!generalEnabled)}
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 border-none cursor-pointer flex items-center ${generalEnabled ? 'bg-accent' : 'bg-input'}`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-[#0a0a0a] shadow-md transform duration-200 ${generalEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
                    {generalEnabled && (
                      <div className="flex items-center gap-1.5 bg-input border border-border-subtle rounded-lg px-2 py-1">
                        <span className="text-[10px] text-text-secondary">Max:</span>
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={generalLimit}
                          onChange={(e) => setGeneralLimit(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-8 bg-transparent border-none text-center text-xs text-text-main font-bold outline-none"
                        />
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border-subtle pt-4 mt-1 select-none">
          <button
            onClick={onClose}
            className="px-5 py-2 border border-border-subtle rounded-lg text-xs font-semibold text-text-secondary hover:text-text-main hover:bg-card-hover transition-colors cursor-pointer select-none bg-transparent"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 bg-[#d4e600] hover:bg-[#b0bf00] active:scale-[0.98] text-[#0a0a0a] font-bold text-xs rounded-lg transition-all shadow-[0_4px_12px_rgba(212,230,0,0.15)] cursor-pointer select-none"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
