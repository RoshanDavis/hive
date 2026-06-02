import type { ReactNode } from "react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import type {
  AgentLLMSlot,
  AgentNodeData,
  AgentSlotKind,
  AgentStorageSlot,
  AgentToolsSlot,
} from "./types";

// Presentational agent card — no React-Flow / handle deps — so the same visual
// renders both on the canvas (AgentNode) and as the full-design drag ghost
// (WorkspaceEditor). Handles + status overlay are passed in via `children`.

const SLOT_TITLE: Record<AgentSlotKind, string> = {
  llm: "LLM",
  storage: "Storage",
  tools: "Tools",
};

/** Slot icons mirror the plugins they accept, so they stay in sync with the
 * palette. `toolsContainer` may not be registered yet — fall back gracefully. */
function slotIcon(kind: AgentSlotKind): string {
  if (kind === "llm") return pluginRegistry.get("llm")?.meta.icon ?? "🧠";
  if (kind === "storage") return pluginRegistry.get("jsonStorage")?.meta.icon ?? "💾";
  return pluginRegistry.get("toolsContainer")?.meta.icon ?? "🛠️";
}

function llmSummary(slot: AgentLLMSlot): string {
  const provider = String(slot.provider ?? "Ollama");
  const model = String(slot.modelName ?? "").trim();
  return model ? `${provider} · ${model}` : provider;
}

function storageSummary(slot: AgentStorageSlot): string {
  const n = Array.isArray(slot.records) ? slot.records.length : 0;
  return `JSON · ${n} record${n === 1 ? "" : "s"}`;
}

function toolsSummary(slot: AgentToolsSlot): string {
  const n =
    (slot.native?.length ?? 0) + (slot.mcp?.length ?? 0) + (slot.skills?.length ?? 0);
  return n === 0 ? "No tools selected" : `${n} tool${n === 1 ? "" : "s"}`;
}

function SlotBox({
  agentId,
  kind,
  filled,
  summary,
  onClick,
}: {
  agentId: string;
  kind: AgentSlotKind;
  filled: boolean;
  summary: string | null;
  onClick?: () => void;
}) {
  const icon = slotIcon(kind);
  const title = SLOT_TITLE[kind];
  return (
    <div
      data-agent-slot={kind}
      data-agent-id={agentId}
      onClick={onClick}
      title={
        filled
          ? `${title}: ${summary}`
          : `Drop a ${title} node here, or click to configure`
      }
      className={`flex flex-col items-center justify-center gap-0.5 rounded-md p-2 w-full aspect-square text-center transition-colors duration-200 cursor-pointer select-none ${
        filled
          ? "border border-border-card bg-card-hover"
          : "border-2 border-dashed border-border-subtle hover:border-border-hover"
      }`}
    >
      <span className={`text-xl leading-none ${filled ? "" : "opacity-40"}`}>{icon}</span>
      <span
        className={`text-[11px] font-semibold ${filled ? "text-text-main" : "text-text-muted"}`}
      >
        {title}
      </span>
      <span className="text-[10px] leading-tight text-text-muted w-full overflow-hidden text-ellipsis whitespace-nowrap">
        {filled ? summary : "Empty"}
      </span>
    </div>
  );
}

export function AgentNodeView({
  data,
  selected = false,
  statusClass = "",
  agentId = "",
  onSlotClick,
  children,
}: {
  data: AgentNodeData;
  selected?: boolean;
  statusClass?: string;
  /** The node id, stamped on each slot box for drop hit-testing (M4). */
  agentId?: string;
  /** Clicking a slot box (canvas only) — used to focus the inspector section. */
  onSlotClick?: (slot: AgentSlotKind) => void;
  /** Handles + StatusBorder overlay, rendered inside the positioned root. */
  children?: ReactNode;
}) {
  const overrideIcon = typeof data.icon === "string" ? data.icon.trim() : "";
  const headerIcon = overrideIcon || pluginRegistry.get("agent")?.meta.icon || "🤖";
  const label = (data.label as string) || "Agent";

  const borderClass = selected
    ? "border-accent-selection shadow-[0_0_12px_color-mix(in_srgb,var(--accent-selection)_15%,transparent)]"
    : "border-border-card";

  return (
    <div
      className={`relative flex flex-col gap-2 bg-card rounded-lg border-2 ${borderClass} ${statusClass} px-3 py-2.5 text-text-main shadow-card transition-all duration-300`}
      style={{ width: 340 }}
    >
      {children}

      <div className="flex items-center justify-center gap-2 px-0.5">
        <span className="text-xl leading-none">{headerIcon}</span>
        <span className="text-sm font-semibold tracking-wide overflow-hidden text-ellipsis whitespace-nowrap">
          {label}
        </span>
      </div>

      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <SlotBox
            agentId={agentId}
            kind="llm"
            filled={!!data.llm}
            summary={data.llm ? llmSummary(data.llm) : null}
            onClick={onSlotClick && (() => onSlotClick("llm"))}
          />
        </div>
        <div className="flex-1 min-w-0">
          <SlotBox
            agentId={agentId}
            kind="storage"
            filled={!!data.storage}
            summary={data.storage ? storageSummary(data.storage) : null}
            onClick={onSlotClick && (() => onSlotClick("storage"))}
          />
        </div>
        <div className="flex-1 min-w-0">
          <SlotBox
            agentId={agentId}
            kind="tools"
            filled={!!data.tools}
            summary={data.tools ? toolsSummary(data.tools) : null}
            onClick={onSlotClick && (() => onSlotClick("tools"))}
          />
        </div>
      </div>
    </div>
  );
}
