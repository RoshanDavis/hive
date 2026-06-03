import { useCallback, useEffect, useState } from "react";
import type { ToolDef } from "@/services/api";
import type { AgentToolSettings } from "@/nodes/types";
import { toolsService, type ToolCategory, type ToolsScope } from "@/services/toolsService";
import {
  categoryIcon,
  isToolRunnable,
  builtinNeedsCredential,
  getBuiltinCredentialId,
} from "@/services/builtInTools";
import NodeGridCard from "@/components/shared/NodeGridCard";
import DashedAddCard from "@/components/shared/DashedAddCard";
import { formLabelClass } from "@/components/shared/FormField";
import ToolPickerMenu from "./ToolPickerMenu";
import ToolFormModal from "./ToolFormModal";

export interface ToolsSelection {
  native: string[];
  mcp: string[];
  skills: string[];
}

const CATEGORIES: { key: ToolCategory; title: string; icon: string; addLabel: string }[] = [
  { key: "native", title: "Native Tools", icon: "🔧", addLabel: "Add tool" },
  { key: "mcp", title: "MCP Servers", icon: "🔌", addLabel: "Add server" },
  { key: "skills", title: "Skills", icon: "✨", addLabel: "Add skill" },
];

interface ToolsSelectorProps {
  value: ToolsSelection;
  onChange: (next: ToolsSelection) => void;
  workspacePath: string;
  /** Per-tool settings (e.g. the web_search credential). Omit to hide tool config UI. */
  toolSettings?: AgentToolSettings;
  onToolSettingsChange?: (next: AgentToolSettings) => void;
}

/** A clicked card opens the tool modal in edit/config mode; the dashed card opens
 * the searchable picker (which can branch to create). `initial` undefined = create. */
type ModalState = { category: ToolCategory; initial?: { def: ToolDef; scope: ToolsScope | null } };

/**
 * Card-grid picker for an Agent's / Tools node's native tools, MCP servers, and
 * skills. Each category shows the selected tools as square cards plus a dashed
 * "add" card that opens a searchable picker (existing tools) with a "create your
 * own" path. Clicking a card opens the unified tool modal (view a built-in /
 * edit a user tool); hovering a card reveals a ✕ to deselect.
 */
export default function ToolsSelector({
  value,
  onChange,
  workspacePath,
  toolSettings,
  onToolSettingsChange,
}: ToolsSelectorProps) {
  const [available, setAvailable] = useState<Record<ToolCategory, ToolDef[]>>({
    native: [],
    mcp: [],
    skills: [],
  });
  const [pickerCategory, setPickerCategory] = useState<ToolCategory | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);

  const reload = useCallback(async () => {
    const [native, mcp, skills] = await Promise.all([
      toolsService.getAvailable("native", workspacePath),
      toolsService.getAvailable("mcp", workspacePath),
      toolsService.getAvailable("skills", workspacePath),
    ]);
    setAvailable({ native, mcp, skills });
  }, [workspacePath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const select = (category: ToolCategory, id: string) => {
    if (value[category].includes(id)) return;
    onChange({ ...value, [category]: [...value[category], id] });
  };

  const deselect = (category: ToolCategory, id: string) => {
    onChange({ ...value, [category]: value[category].filter((x) => x !== id) });
  };

  /** Status line under a selected card, or undefined for a runnable, configured tool. */
  const cardSubtitle = (
    category: ToolCategory,
    def: ToolDef | undefined,
    id: string
  ): string | undefined => {
    if (builtinNeedsCredential(id) && !getBuiltinCredentialId(toolSettings, id)) return "⚠ needs key";
    if (!def) return undefined;
    if (!isToolRunnable(category, def)) {
      if (category === "mcp") return "⚠ needs connection";
      if (category === "native") return "⚠ needs setup";
      return "not runnable yet";
    }
    return undefined;
  };

  return (
    <div className="flex flex-col gap-4">
      {CATEGORIES.map(({ key, title, icon, addLabel }) => {
        const selected = value[key];
        const byId = new Map(available[key].map((t) => [t.id, t]));
        return (
          <div key={key} className="flex flex-col gap-2">
            <span className={formLabelClass}>
              {icon} {title}
              {selected.length > 0 ? ` (${selected.length})` : ""}
            </span>

            <div className="grid grid-cols-3 gap-2">
              {selected.map((id) => {
                const def = byId.get(id);
                return (
                  <NodeGridCard
                    key={id}
                    icon={def?.icon || categoryIcon(key)}
                    label={def?.label || id}
                    title={def?.description || def?.label || id}
                    subtitle={cardSubtitle(key, def, id)}
                    onClick={() =>
                      setModal({ category: key, initial: { def: def ?? { id, label: id }, scope: null } })
                    }
                    onClear={() => deselect(key, id)}
                    clearTitle="Remove from agent"
                  />
                );
              })}
              <DashedAddCard
                label={addLabel}
                title={`Add a ${title.toLowerCase().replace(/s$/, "")}`}
                active={pickerCategory === key}
                onClick={() => setPickerCategory(key)}
              />
            </div>
          </div>
        );
      })}

      {pickerCategory && (
        <ToolPickerMenu
          category={pickerCategory}
          workspacePath={workspacePath}
          excludeIds={value[pickerCategory]}
          onPick={(id) => select(pickerCategory, id)}
          onCreateNew={() => {
            setModal({ category: pickerCategory });
            setPickerCategory(null);
          }}
          onClose={() => {
            setPickerCategory(null);
            void reload();
          }}
        />
      )}

      {modal && (
        <ToolFormModal
          category={modal.category}
          workspacePath={workspacePath}
          initial={modal.initial}
          toolSettings={toolSettings}
          onToolSettingsChange={onToolSettingsChange}
          onSaved={(id) => {
            const { category, initial } = modal;
            setModal(null);
            void reload();
            if (!initial) select(category, id); // newly created → add to the agent
          }}
          onRemove={
            modal.initial ? () => deselect(modal.category, modal.initial!.def.id) : undefined
          }
          onClose={() => {
            setModal(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}
