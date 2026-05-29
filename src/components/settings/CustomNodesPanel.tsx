import { useState } from "react";
import { useCustomNodes } from "@/contexts/CustomNodesContext";
import NodeGridCard from "@/components/shared/NodeGridCard";
import DashedAddCard from "@/components/shared/DashedAddCard";
import CustomNodeFormModal, {
  type CustomNodeFormInitial,
} from "@/components/customNodes/CustomNodeFormModal";
import type { CustomNodeDefinition, CustomNodeScope } from "@/types/customNodes";

interface Props {
  showToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function CustomNodesPanel({ showToast }: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CustomNodeFormInitial | null>(null);
  const { globalDefs, workspaceDefs, deleteCustomNode } = useCustomNodes();

  const openEdit = (def: CustomNodeDefinition, scope: CustomNodeScope) => {
    const common = {
      id: def.id,
      name: def.name,
      icon: def.icon,
      color: def.color,
      category: def.category,
      scope,
    };
    if (def.kind === "script") {
      setEditing({
        ...common,
        kind: "script",
        runtime: def.runtime,
        entry: def.entry,
        configSchema: def.configSchema,
        network: def.network,
        credentials: def.credentials,
        limits: def.limits,
        handles: def.handles,
      });
    } else {
      setEditing({
        ...common,
        kind: "preset",
        baseType: def.baseType,
        presetData: def.presetData,
        lockBaseType: true,
      });
    }
  };

  const handleDelete = async (scope: CustomNodeScope, id: string) => {
    try {
      await deleteCustomNode(scope, id);
      showToast("Custom node deleted", "success");
    } catch (err) {
      showToast(`Failed to delete: ${err}`, "error");
    }
  };

  const renderCards = (defs: CustomNodeDefinition[], scope: CustomNodeScope) =>
    defs.map((def) => (
      <NodeGridCard
        key={def.id}
        icon={def.icon}
        label={def.name}
        color={def.color}
        title={`Edit ${def.name}`}
        onClick={() => openEdit(def, scope)}
        onClear={scope === "workspace" ? () => handleDelete(scope, def.id) : undefined}
        clearTitle="Delete custom node"
      />
    ));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5 border-b border-border-subtle pb-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-bold text-text-main hover:text-accent transition-colors bg-transparent border-none cursor-pointer p-0 select-none outline-none"
        >
          <span>{open ? "▼" : "▶"} Custom Nodes</span>
        </button>
        <p className="text-[10px] text-text-muted mt-1">
          Reusable presets of existing node types. Workspace nodes can be promoted to global (all
          workspaces). Global nodes are managed on the landing-page Nodes tab.
        </p>
      </div>

      {open && (
        <div className="flex flex-col gap-3 animate-[fadeIn_0.15s_ease-out]">
          {workspaceDefs.length > 0 && (
            <span className="text-[10px] uppercase tracking-widest font-bold text-text-muted">
              📁 Workspace
            </span>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {renderCards(workspaceDefs, "workspace")}
            <DashedAddCard
              label="Add custom node"
              title="Create a workspace custom node"
              onClick={() => setCreating(true)}
            />
          </div>

          {globalDefs.length > 0 && (
            <>
              <span className="text-[10px] uppercase tracking-widest font-bold text-text-muted mt-1">
                🌐 Global
              </span>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {renderCards(globalDefs, "global")}
              </div>
            </>
          )}
        </div>
      )}

      {creating && (
        <CustomNodeFormModal
          isOpen={creating}
          onClose={() => setCreating(false)}
          showToast={showToast}
          allowWorkspaceScope={true}
        />
      )}

      {editing && (
        <CustomNodeFormModal
          isOpen={editing !== null}
          onClose={() => setEditing(null)}
          showToast={showToast}
          allowWorkspaceScope={true}
          initial={editing}
        />
      )}
    </div>
  );
}
