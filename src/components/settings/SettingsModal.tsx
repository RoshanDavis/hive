
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function SettingsModal({ isOpen, onClose, showToast }: SettingsModalProps) {
  if (!isOpen) return null;

  const handleSave = () => {
    showToast("Settings saved ✓", "success");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050505]/75 backdrop-blur-md animate-[fadeIn_0.2s_ease-out]">
      <div className="absolute inset-0 cursor-default" onClick={onClose} />

      <div className="settings-modal-container">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle pb-4">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">⚙️</span>
            <div>
              <h2 className="text-lg font-bold text-text-main">Settings</h2>
              <p className="text-[11px] text-text-muted mt-0.5">Configure application behavior</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-main hover:bg-card-hover transition-colors text-sm cursor-pointer border-none bg-transparent"
          >
            ✕
          </button>
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center gap-2 pr-1 py-8 text-center text-xs text-text-secondary select-none">
          <span className="text-2xl">🐝</span>
          <span>General settings are currently managed automatically.</span>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border-subtle pt-4 mt-1 select-none">
          <button
            onClick={onClose}
            className="px-5 py-2 border border-border-subtle rounded-lg text-xs font-semibold text-text-secondary hover:text-text-main hover:bg-card-hover transition-colors cursor-pointer select-none"
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
