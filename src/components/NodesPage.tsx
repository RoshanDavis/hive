import { useMemo, useState } from "react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { useRegistryVersion } from "@/hooks/useRegistryVersion";
import { useCustomNodes } from "@/contexts/CustomNodesContext";
import DefaultsEditorModal from "@/components/defaults/DefaultsEditorModal";
import CustomNodeFormModal, {
  type CustomNodeFormInitial,
} from "@/components/customNodes/CustomNodeFormModal";
import { rankedSearch } from "@/utils/rankedSearch";
import NodeGridCard from "@/components/shared/NodeGridCard";
import DashedAddCard from "@/components/shared/DashedAddCard";
import { customTypeFor, isCustomType } from "@/types/customNodes";

interface NodesPageProps {
  showToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function NodesPage({ showToast }: NodesPageProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [editingType, setEditingType] = useState<string | null>(null);
  const [showCreateCustom, setShowCreateCustom] = useState(false);
  const [editingCustom, setEditingCustom] = useState<CustomNodeFormInitial | null>(null);

  const registryVersion = useRegistryVersion();
  const { globalDefs } = useCustomNodes();
  const plugins = useMemo(() => pluginRegistry.getAll(), [registryVersion]);

  // Clicking a card: custom nodes open the custom-node editor; built-ins open
  // the defaults editor.
  const handleCardClick = (type: string) => {
    if (isCustomType(type)) {
      const def = globalDefs.find((d) => customTypeFor(d.id) === type);
      if (def) {
        const common = {
          id: def.id,
          name: def.name,
          icon: def.icon,
          category: def.category,
          scope: "global" as const,
        };
        if (def.kind === "script") {
          setEditingCustom({
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
          setEditingCustom({
            ...common,
            kind: "preset",
            baseType: def.baseType,
            presetData: def.presetData,
            lockBaseType: true,
          });
        }
      }
    } else {
      setEditingType(type);
    }
  };
  const filtered = useMemo(
    () =>
      rankedSearch(plugins, searchQuery, {
        primary: (p) => p.meta.label,
        secondary: [
          { value: (p) => p.type, score: 50 },
          { value: (p) => p.meta.description, score: 40 },
        ],
      }),
    [plugins, searchQuery]
  );

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 md:p-8 overflow-y-auto w-full">
      {/* Hero */}
      <div className="text-center mb-10 mt-4 flex flex-col items-center select-none">
        <span className="text-5xl mb-4 hover:scale-110 transition-transform duration-300 cursor-default filter drop-shadow-[0_0_12px_rgba(212,230,0,0.35)]">
          🧩
        </span>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-accent via-text-main to-text-secondary">
          Nodes
        </h1>
        <p className="text-xs sm:text-sm text-text-secondary mt-2 max-w-md mx-auto leading-relaxed">
          Configure default values for nodes across all workspaces, or add your own
        </p>
      </div>

      {/* Search */}
      <div className="w-full max-w-xl mx-auto mb-10 px-1">
        <div className="flex items-center bg-card/60 backdrop-blur-md rounded-xl border border-border-subtle px-4 py-2.5 focus-within:border-accent-dim focus-within:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] transition-all duration-300">
          <span className="text-text-secondary text-base mr-3 select-none">🔍</span>
          <input
            className="flex-1 bg-transparent border-none outline-none text-text-main text-sm placeholder:text-text-muted"
            type="text"
            placeholder="Search nodes by name or type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="text-text-secondary hover:text-text-main text-xs px-1 select-none cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* No-match hint — the grid (and its add card) still renders below */}
      {filtered.length === 0 && searchQuery.trim() !== "" && (
        <div className="flex flex-col items-center justify-center text-text-muted gap-1.5 mb-6">
          <span className="text-2xl opacity-50 select-none">🔍</span>
          <span className="text-sm">No nodes match "{searchQuery}"</span>
        </div>
      )}

      {/* Grid — the "add custom node" card stays present even with no search matches */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5 max-w-300 w-full mx-auto px-1">
        {filtered.map((p) => (
          <NodeGridCard
            key={p.type}
            icon={p.meta.icon}
            label={p.meta.label}
            color={p.meta.color}
            title={isCustomType(p.type) ? "Edit custom node" : p.meta.description}
            onClick={() => handleCardClick(p.type)}
          />
        ))}

        {/* Add custom node */}
        <DashedAddCard
          label="Add custom node"
          title="Add your own node type"
          onClick={() => setShowCreateCustom(true)}
        />
      </div>

      {editingType && (
        <DefaultsEditorModal
          isOpen={editingType !== null}
          onClose={() => setEditingType(null)}
          pluginType={editingType}
          scope="global"
          workspacePath={null}
          showToast={showToast}
        />
      )}

      {showCreateCustom && (
        <CustomNodeFormModal
          isOpen={showCreateCustom}
          onClose={() => setShowCreateCustom(false)}
          showToast={showToast}
          allowWorkspaceScope={false}
        />
      )}

      {editingCustom && (
        <CustomNodeFormModal
          isOpen={editingCustom !== null}
          onClose={() => setEditingCustom(null)}
          showToast={showToast}
          allowWorkspaceScope={false}
          initial={editingCustom}
        />
      )}
    </div>
  );
}
