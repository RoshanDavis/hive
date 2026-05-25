import { useState, useMemo, useEffect, useRef } from "react";
import { NODE_REGISTRY } from "@/nodes/registry";

interface NodeSelectorPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (nodeType: string) => void;
  activeNodeTypes: string[];
}

export default function NodeSelectorPopup({
  isOpen,
  onClose,
  onSelect,
  activeNodeTypes,
}: NodeSelectorPopupProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery("");
    }
  }, [isOpen]);

  // Listen to Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Filter available nodes (only those in registry, not 'output' legacy type, and not already active)
  const availableNodes = useMemo(() => {
    const baseList = NODE_REGISTRY.filter(
      (d) => d.type !== "output" && !activeNodeTypes.includes(d.type)
    );
    const query = searchQuery.trim().toLowerCase();
    if (!query) return baseList;

    return baseList.filter(
      (def) =>
        def.label.toLowerCase().includes(query) ||
        def.description.toLowerCase().includes(query)
    );
  }, [searchQuery, activeNodeTypes]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#020202]/50 backdrop-blur-[2px] animate-[fadeIn_0.15s_ease-out]">
      {/* Backdrop click closes popup */}
      <div className="absolute inset-0 cursor-default" onClick={onClose} />

      {/* Popover Card */}
      <div className="relative w-full max-w-[320px] bg-[#121212] border border-[#2a2a2a] rounded-xl p-4 shadow-[0_16px_40px_rgba(0,0,0,0.8)] flex flex-col gap-3 select-none animate-[scaleUp_0.15s_ease-out] z-10">
        <div className="flex items-center justify-between border-b border-[#222] pb-2">
          <span className="text-[12px] font-bold text-text-main uppercase tracking-wider">
            Add Node Concurrency
          </span>
          <button
            onClick={onClose}
            className="text-xs text-text-muted hover:text-text-main transition-colors border-none bg-transparent cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <input
          ref={inputRef}
          type="text"
          placeholder="Search node types..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-[#1e1e1e] border border-[#2e2e2e] rounded-md px-2.5 py-1.5 text-xs text-text-main outline-none focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] transition-all"
        />

        {/* Scrollable list */}
        <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto pr-0.5">
          {availableNodes.length > 0 ? (
            availableNodes.map((def) => (
              <button
                key={def.type}
                onClick={() => {
                  onSelect(def.type);
                  onClose();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-transparent hover:bg-[#1a1a1a] border border-transparent hover:border-[#2a2a2a] text-left transition-all cursor-pointer group"
              >
                <span className="text-base shrink-0 group-hover:scale-110 transition-transform">
                  {def.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-text-main">
                    {def.label}
                  </div>
                  <div className="text-[9px] text-text-muted truncate leading-normal">
                    {def.description}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-text-muted gap-1 text-[10px]">
              <span>🔍</span>
              <span>No available nodes found</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
