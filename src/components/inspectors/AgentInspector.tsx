import { useEffect, useRef } from "react";
import type { InspectorProps } from "./types";
import type { NodeOutputEnvelope } from "@/engine/types";
import type {
  AgentLLMSlot,
  AgentNodeData,
  AgentSlotKind,
  AgentStorageSlot,
  AgentToolSettings,
  AgentToolsSlot,
} from "@/nodes/types";
import type { ToolTraceStep } from "@/engine/agentTools";
import { normalizeAgentStorage } from "@/engine/agentMemory";
import { agentSlotFocus } from "@/nodes/agentSlotFocus";
import { LLM_DEFAULT_DATA } from "@/nodes/llmDefaults";
import CollapsibleSection from "./CollapsibleSection";
import InspectorActions from "./InspectorActions";
import LLMConfigFields from "./shared/LLMConfigFields";
import LastResponseSection from "./shared/LastResponseSection";
import ToolsSelector, { type ToolsSelection } from "./shared/ToolsSelector";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import { actionButtonNeutralClass, actionButtonDangerClass } from "./actionButtonStyles";

/** A fresh LLM slot seeded from the LLM node's defaults (sans its label). */
function defaultLlmSlot(): AgentLLMSlot {
  const base: Record<string, unknown> = { ...LLM_DEFAULT_DATA };
  delete base.label;
  return base as AgentLLMSlot;
}

function SlotEmpty({
  hint,
  addLabel,
  onAdd,
}: {
  hint: string;
  addLabel: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-text-muted leading-relaxed m-0">{hint}</p>
      <button type="button" className={actionButtonNeutralClass} onClick={onAdd}>
        <span>＋</span>
        <span>{addLabel}</span>
      </button>
    </div>
  );
}

/** One storage-section row: icon + label + count + a Clear button. */
function StorageSection({
  icon,
  label,
  hint,
  count,
  unit,
  onClear,
}: {
  icon: string;
  label: string;
  hint: string;
  count: number;
  unit: string;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-card/40 px-2.5 py-2">
      <div className="flex flex-col min-w-0">
        <span className="text-xs text-text-main font-semibold">
          {icon} {label}{" "}
          <span className="text-[10px] text-text-muted font-normal">
            ({count} {unit}
            {count === 1 ? "" : "s"})
          </span>
        </span>
        <span className="text-[10px] text-text-muted">{hint}</span>
      </div>
      <button
        type="button"
        className="shrink-0 text-[11px] text-text-muted hover:text-danger border border-border-subtle rounded px-2 py-1 cursor-pointer bg-card hover:bg-card-hover disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={onClear}
        disabled={count === 0}
      >
        Clear
      </button>
    </div>
  );
}

function StorageSlotEditor({
  storage,
  onChange,
  onRemove,
}: {
  storage: AgentStorageSlot;
  onChange: (next: AgentStorageSlot) => void;
  onRemove: () => void;
}) {
  const norm = normalizeAgentStorage(storage);
  const recentMemory = norm.memory.slice(-5).reverse();
  return (
    <div className="flex flex-col gap-2.5">
      <StorageSection
        icon="💬"
        label="Conversation"
        hint="Dialogue history loaded into the model."
        count={norm.conversation.length}
        unit="turn"
        onClear={() => onChange({ ...norm, conversation: [] })}
      />
      <StorageSection
        icon="🧠"
        label="Memory"
        hint="Facts the agent saves/recalls via memory tools."
        count={norm.memory.length}
        unit="entry"
        onClear={() => onChange({ ...norm, memory: [] })}
      />
      {recentMemory.length > 0 && (
        <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
          {recentMemory.map((r) => (
            <div
              key={r.id}
              className="rounded-md border border-border-subtle bg-card/40 px-2 py-1.5"
            >
              <div className="flex justify-between gap-2 text-[10px] text-text-muted">
                <span className="truncate">{r.source}</span>
                <span className="shrink-0">{r.timestamp}</span>
              </div>
              <div className="text-[11px] text-text-main mt-0.5 line-clamp-2 wrap-break-word">
                {r.content}
              </div>
            </div>
          ))}
        </div>
      )}
      <StorageSection
        icon="📊"
        label="Run data"
        hint="Structured record (input/output/trace) per run."
        count={norm.runData.length}
        unit="run"
        onClear={() => onChange({ ...norm, runData: [] })}
      />

      <button type="button" className={actionButtonDangerClass} onClick={onRemove}>
        <span>Remove</span>
      </button>
    </div>
  );
}

function ToolsSlotEditor({
  tools,
  workspacePath,
  onChange,
  onToolSettingsChange,
  onRemove,
}: {
  tools: AgentToolsSlot;
  workspacePath: string;
  onChange: (next: ToolsSelection) => void;
  onToolSettingsChange: (next: AgentToolSettings) => void;
  onRemove: () => void;
}) {
  // `limitToolRounds` undefined ⇒ on (so it's on by default and existing agents keep a cap).
  const limitEnabled = tools.toolSettings?.limitToolRounds !== false;
  return (
    <div className="flex flex-col gap-3">
      <ToolsSelector
        value={{
          native: tools.native ?? [],
          mcp: tools.mcp ?? [],
          skills: tools.skills ?? [],
        }}
        onChange={onChange}
        workspacePath={workspacePath}
        toolSettings={tools.toolSettings}
        onToolSettingsChange={onToolSettingsChange}
      />

      <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-text-muted">Limit tool-call rounds</label>
          <ToggleSwitch
            checked={limitEnabled}
            onChange={(next) =>
              onToolSettingsChange({ ...tools.toolSettings, limitToolRounds: next })
            }
            title={
              limitEnabled
                ? "On — cap the number of model⇄tool rounds"
                : "Off — no round limit (runs until the model stops calling tools)"
            }
            ariaLabel="Limit tool-call rounds"
          />
        </div>
        {limitEnabled ? (
          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] text-text-muted">Max rounds (default 10)</label>
            <input
              type="number"
              min={1}
              max={25}
              className="w-20 bg-input border border-border-subtle rounded-md px-2 py-1 text-xs text-text-main outline-none focus:border-accent-dim"
              value={tools.toolSettings?.maxIterations ?? ""}
              placeholder="10"
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                onToolSettingsChange({
                  ...tools.toolSettings,
                  maxIterations: Number.isFinite(n) ? n : undefined,
                });
              }}
            />
          </div>
        ) : (
          <p className="text-[11px] text-warning/90 bg-warning/10 border border-warning/30 rounded-md px-2.5 py-1.5 m-0 leading-relaxed">
            ⚠ No limit — the agent keeps running until it stops calling tools. Use Stop to
            halt a run. May incur significant cost.
          </p>
        )}
      </div>

      <button type="button" className={actionButtonDangerClass} onClick={onRemove}>
        <span>Remove Tools</span>
      </button>
    </div>
  );
}

export default function AgentInspector({
  node,
  onUpdate,
  workspacePath,
  onSaveAsCustom,
  onDeleteNode,
}: InspectorProps) {
  const data = node.data as AgentNodeData;
  const llm = (data.llm ?? null) as AgentLLMSlot | null;
  const storage = (data.storage ?? null) as AgentStorageSlot | null;
  const tools = (data.tools ?? null) as AgentToolsSlot | null;

  const llmRef = useRef<HTMLDivElement>(null);
  const storageRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);

  // Clicking a slot box on the canvas scrolls the matching section into view.
  useEffect(() => {
    const refs: Record<AgentSlotKind, React.RefObject<HTMLDivElement | null>> = {
      llm: llmRef,
      storage: storageRef,
      tools: toolsRef,
    };
    const scrollTo = (slot: AgentSlotKind) =>
      refs[slot].current?.scrollIntoView({ behavior: "smooth", block: "nearest" });

    const pending = agentSlotFocus.consumePending(node.id);
    if (pending) requestAnimationFrame(() => scrollTo(pending));

    return agentSlotFocus.subscribe(node.id, scrollTo);
  }, [node.id]);

  const envelope = data.outputEnvelope as NodeOutputEnvelope | undefined;
  const lastValue = envelope?.value;
  // Tool Activity: prefer the live (transient) run log; fall back to the
  // persisted tool trace on the envelope so it survives a reload.
  const logs = Array.isArray(data.logs) ? (data.logs as string[]) : [];
  const trace = (envelope?.data?.toolTrace ?? []) as ToolTraceStep[];
  const activityLines =
    logs.length > 0
      ? logs
      : trace.map(
          (t) => `🔧 ${t.name}(${t.arguments}) → ${t.error ? "error: " : ""}${t.content}`
        );

  return (
    <div className="flex flex-col gap-3">
      <div ref={llmRef}>
        <CollapsibleSection title="LLM" icon="🧠" defaultOpen={true}>
          {llm ? (
            <div className="flex flex-col gap-3">
              <LLMConfigFields
                values={llm}
                onChange={(next) => onUpdate(node.id, { llm: next })}
                workspacePath={workspacePath}
              />
              <button
                type="button"
                className={actionButtonDangerClass}
                onClick={() => onUpdate(node.id, { llm: null })}
              >
                <span>Remove LLM</span>
              </button>
            </div>
          ) : (
            <SlotEmpty
              hint="No LLM configured. Drag an LLM node onto the slot, or add one here."
              addLabel="Add LLM"
              onAdd={() => onUpdate(node.id, { llm: defaultLlmSlot() })}
            />
          )}
        </CollapsibleSection>
      </div>

      <div ref={storageRef}>
        <CollapsibleSection title="Storage" icon="💾" defaultOpen={true}>
          {storage ? (
            <StorageSlotEditor
              storage={storage}
              onChange={(next) => onUpdate(node.id, { storage: next })}
              onRemove={() => onUpdate(node.id, { storage: null })}
            />
          ) : (
            <SlotEmpty
              hint="No memory configured. Drag a JSON Storage node onto the slot, or add one here."
              addLabel="Add JSON Storage"
              onAdd={() =>
                onUpdate(node.id, {
                  storage: { kind: "jsonStorage", conversation: [], memory: [], runData: [] },
                })
              }
            />
          )}
        </CollapsibleSection>
      </div>

      <div ref={toolsRef}>
        <CollapsibleSection title="Tools" icon="🛠️" defaultOpen={true}>
          {tools ? (
            <ToolsSlotEditor
              tools={tools}
              workspacePath={workspacePath}
              onChange={(next) => onUpdate(node.id, { tools: { ...tools, ...next } })}
              onToolSettingsChange={(ts) =>
                onUpdate(node.id, { tools: { ...tools, toolSettings: ts } })
              }
              onRemove={() => onUpdate(node.id, { tools: null })}
            />
          ) : (
            <SlotEmpty
              hint="No tools configured. Drag a Tools node onto the slot, or add one here."
              addLabel="Add Tools"
              onAdd={() =>
                onUpdate(node.id, { tools: { native: [], mcp: [], skills: [] } })
              }
            />
          )}
        </CollapsibleSection>
      </div>

      <CollapsibleSection
        title="Logs"
        icon="🔧"
        defaultOpen={false}
        badge={activityLines.length || undefined}
      >
        {activityLines.length > 0 ? (
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {activityLines.map((line, i) => (
              <div
                key={i}
                className="text-[11px] text-text-main font-mono wrap-break-word rounded-md border border-border-subtle bg-card/40 px-2 py-1"
              >
                {line}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-text-muted/80 italic m-0">
            No activity yet. Tool calls and run notes from the latest run appear here.
          </p>
        )}
      </CollapsibleSection>

      <LastResponseSection
        value={lastValue}
        onClear={() => onUpdate(node.id, { outputEnvelope: undefined })}
      />

      <InspectorActions onSaveAsCustom={onSaveAsCustom} onDeleteNode={onDeleteNode} />
    </div>
  );
}
