import { useCallback, useEffect, useState } from "react";
import type { ToolDef } from "@/services/api";
import { toolsService, type ToolCategory, type ToolsScope } from "@/services/toolsService";
import { categoryIcon } from "@/services/builtInTools";
import NodeGridCard from "@/components/shared/NodeGridCard";
import DashedAddCard from "@/components/shared/DashedAddCard";
import ToolFormModal from "@/components/inspectors/shared/ToolFormModal";

interface Props {
  workspacePath: string;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
}

const CATEGORIES: { key: ToolCategory; title: string; addLabel: string }[] = [
  { key: "native", title: "Native Tools", addLabel: "Add tool" },
  { key: "mcp", title: "MCP Servers", addLabel: "Add server" },
  { key: "skills", title: "Skills", addLabel: "Add skill" },
];

type ScopedTools = { global: ToolDef[]; workspace: ToolDef[] };
type ModalState = { category: ToolCategory; initial?: { def: ToolDef; scope: ToolsScope | null } };

const EMPTY: Record<ToolCategory, ScopedTools> = {
  native: { global: [], workspace: [] },
  mcp: { global: [], workspace: [] },
  skills: { global: [], workspace: [] },
};

/**
 * Settings panel for the tool registry — user native tools, MCP servers, and
 * skills available to Agent nodes — mirroring {@link CustomNodesPanel}. Lets the
 * user create/edit/delete tools at workspace or global scope without a node on
 * the canvas. Built-ins aren't listed (they can't be edited/removed).
 */
export default function ToolsPanel({ workspacePath, showToast }: Props) {
  const [open, setOpen] = useState(true);
  const [tools, setTools] = useState<Record<ToolCategory, ScopedTools>>(EMPTY);
  const [modal, setModal] = useState<ModalState | null>(null);

  const reload = useCallback(async () => {
    const [native, mcp, skills] = await Promise.all([
      toolsService.listUserTools("native", workspacePath),
      toolsService.listUserTools("mcp", workspacePath),
      toolsService.listUserTools("skills", workspacePath),
    ]);
    setTools({ native, mcp, skills });
  }, [workspacePath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDelete = async (category: ToolCategory, id: string) => {
    try {
      await toolsService.removeTool(category, id, workspacePath);
      showToast("Tool deleted", "success");
      void reload();
    } catch (err) {
      showToast(`Failed to delete: ${err}`, "error");
    }
  };

  const renderCards = (category: ToolCategory, defs: ToolDef[], scope: ToolsScope) =>
    defs.map((def) => (
      <NodeGridCard
        key={`${scope}:${def.id}`}
        icon={def.icon || categoryIcon(category)}
        label={def.label}
        title={`Edit ${def.label}`}
        onClick={() => setModal({ category, initial: { def, scope } })}
        onClear={() => handleDelete(category, def.id)}
        clearTitle="Delete tool"
      />
    ));

  const scopeLabelClass = "text-[10px] uppercase tracking-widest font-bold text-text-muted";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5 border-b border-border-subtle pb-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-bold text-text-main hover:text-text-secondary transition-colors bg-transparent border-none cursor-pointer p-0 select-none outline-none"
        >
          <span>{open ? "▼" : "▶"} Tools</span>
        </button>
        <p className="text-[10px] text-text-muted mt-1">
          Native tools, MCP servers, and skills that Agent nodes can use. Workspace tools apply
          here; global tools apply in every workspace.
        </p>
      </div>

      {open && (
        <div className="flex flex-col gap-5 animate-[fadeIn_0.15s_ease-out]">
          {CATEGORIES.map(({ key, title, addLabel }) => {
            const { global, workspace } = tools[key];
            return (
              <div key={key} className="flex flex-col gap-2">
                <span className="text-[11px] font-bold text-text-secondary">
                  {categoryIcon(key)} {title}
                </span>

                {workspace.length > 0 && <span className={scopeLabelClass}>📁 Workspace</span>}
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {renderCards(key, workspace, "workspace")}
                  <DashedAddCard
                    label={addLabel}
                    title={`Create a ${title.toLowerCase().replace(/s$/, "")}`}
                    onClick={() => setModal({ category: key })}
                  />
                </div>

                {global.length > 0 && (
                  <>
                    <span className={`${scopeLabelClass} mt-1`}>🌐 Global</span>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                      {renderCards(key, global, "global")}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <ToolFormModal
          category={modal.category}
          workspacePath={workspacePath}
          initial={modal.initial}
          onSaved={() => {
            setModal(null);
            void reload();
          }}
          onClose={() => {
            setModal(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}
