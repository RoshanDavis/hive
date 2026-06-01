import { useMemo, useState } from "react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { nodeDefaultsService } from "@/services/nodeDefaultsService";
import { useNodeDefaults } from "@/contexts/NodeDefaultsContext";
import DefaultsEditorModal from "@/components/defaults/DefaultsEditorModal";
import NodeGridCard from "@/components/shared/NodeGridCard";
import DashedAddCard from "@/components/shared/DashedAddCard";
import NodePickerMenu from "@/components/shared/NodePickerMenu";

interface NodeDefaultsPanelProps {
  workspacePath: string;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function NodeDefaultsPanel({ workspacePath, showToast }: NodeDefaultsPanelProps) {
  const [open, setOpen] = useState(false);
  const [editingType, setEditingType] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Single source of truth: the same context that handleAddNode reads from.
  // Refreshing it here means edits apply to new nodes immediately (no reload).
  const { workspace, refresh } = useNodeDefaults();

  const overrideTypes = useMemo(() => {
    const defaults = workspace.defaults ?? {};
    return Object.keys(defaults).filter((k) => {
      const v = defaults[k];
      return v && typeof v === "object" && Object.keys(v).length > 0;
    });
  }, [workspace]);

  const handleClear = async (type: string) => {
    try {
      await nodeDefaultsService.clearDefaultsForType("workspace", type, workspacePath);
      showToast("Workspace override cleared", "success");
      await refresh();
    } catch (err) {
      showToast(`Failed to clear: ${err}`, "error");
    }
  };

  // Resolve override types to plugins, skipping any unknown/stale types.
  const overriddenPlugins = useMemo(
    () =>
      overrideTypes
        .map((type) => pluginRegistry.get(type))
        .filter((p): p is NonNullable<typeof p> => Boolean(p)),
    [overrideTypes]
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5 border-b border-border-subtle pb-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-bold text-text-main hover:text-accent transition-colors bg-transparent border-none cursor-pointer p-0 select-none outline-none"
        >
          <span>{open ? "▼" : "▶"} Node Defaults</span>
        </button>
        <p className="text-[10px] text-text-muted mt-1">
          Add a node here only to override its defaults for this workspace. Anything not listed
          inherits the global defaults (configured on the landing-page Nodes tab).
        </p>
      </div>

      {open && (
        <div className="flex flex-col gap-3 animate-[fadeIn_0.15s_ease-out]">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {overriddenPlugins.map((p) => (
              <NodeGridCard
                key={p.type}
                icon={p.meta.icon}
                label={p.meta.label}
                title={`Edit ${p.meta.label} workspace defaults`}
                onClick={() => setEditingType(p.type)}
                onClear={() => handleClear(p.type)}
                clearTitle="Clear workspace override"
              />
            ))}

            <DashedAddCard
              label="Add node"
              title="Override a node's defaults for this workspace"
              active={pickerOpen}
              onClick={() => setPickerOpen((v) => !v)}
            />
          </div>

          {pickerOpen && (
            <NodePickerMenu
              exclude={overrideTypes}
              onClose={() => setPickerOpen(false)}
              onPick={(type) => {
                setPickerOpen(false);
                setEditingType(type);
              }}
            />
          )}
        </div>
      )}

      {editingType && (
        <DefaultsEditorModal
          isOpen={editingType !== null}
          onClose={() => setEditingType(null)}
          pluginType={editingType}
          scope="workspace"
          workspacePath={workspacePath}
          showToast={showToast}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
