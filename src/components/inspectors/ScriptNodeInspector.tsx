import { useEffect, useMemo, useState } from "react";
import type { InspectorProps } from "./types";
import type { NodeOutputEnvelope } from "@/engine/types";
import DataConsole from "./shared/DataConsole";
import CollapsibleSection from "./CollapsibleSection";
import InspectorActions from "./InspectorActions";
import { api } from "@/services/api";
import { credentialService } from "@/services/credentialService";
import { useCustomNodes } from "@/contexts/CustomNodesContext";
import { formInputClass, formLabelClass } from "@/components/shared/FormField";
import {
  CUSTOM_TYPE_PREFIX,
  type CustomNodeScope,
  type ScriptCustomNode,
  type ScriptField,
} from "@/types/customNodes";

/** Render one configSchema field bound to node.data[field.key]. */
function ConfigField({
  field,
  value,
  onChange,
}: {
  field: ScriptField;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={formLabelClass}>
        {field.label}
        {field.required && <span className="text-danger"> *</span>}
      </label>
      {field.type === "boolean" ? (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 cursor-pointer self-start"
        />
      ) : field.type === "select" ? (
        <select
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={formInputClass}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : field.type === "number" ? (
        <input
          type="number"
          value={value === undefined || value === null ? "" : Number(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          className={formInputClass}
        />
      ) : (
        <input
          type={field.type === "password" ? "password" : "text"}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={formInputClass}
        />
      )}
    </div>
  );
}

export default function ScriptNodeInspector({
  node,
  onUpdate,
  isRunning,
  onRun,
  workspacePath,
  onDeleteNode,
}: InspectorProps) {
  const { globalDefs, workspaceDefs } = useCustomNodes();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableCredIds, setAvailableCredIds] = useState<Set<string>>(new Set());

  // Which granted credentials actually resolve on this machine. Used to flag
  // dangling grants after a node is promoted/transplanted (ids don't travel).
  useEffect(() => {
    let cancelled = false;
    credentialService
      .list(workspacePath || undefined)
      .then((list) => {
        if (!cancelled) setAvailableCredIds(new Set(list.map((c) => c.id)));
      })
      .catch(() => {
        if (!cancelled) setAvailableCredIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  const id = (node.type ?? "").startsWith(CUSTOM_TYPE_PREFIX)
    ? (node.type as string).slice(CUSTOM_TYPE_PREFIX.length)
    : "";

  // Workspace defs win over global if the same id is somehow present in both.
  const resolved = useMemo<{ def: ScriptCustomNode; scope: CustomNodeScope } | null>(() => {
    const ws = workspaceDefs.find((d) => d.id === id);
    if (ws && ws.kind === "script") return { def: ws, scope: "workspace" };
    const g = globalDefs.find((d) => d.id === id);
    if (g && g.kind === "script") return { def: g, scope: "global" };
    return null;
  }, [id, globalDefs, workspaceDefs]);

  const logs = Array.isArray(node.data?.logs) ? (node.data.logs as string[]) : [];
  const envelopeValue = (node.data?.outputEnvelope as NodeOutputEnvelope | undefined)?.value;
  const output = envelopeValue !== undefined && envelopeValue !== null
    ? String(envelopeValue)
    : undefined;
  const hasOutput = output !== undefined && output !== "";

  const handleOpen = async () => {
    if (!resolved) return;
    setOpening(true);
    setError(null);
    try {
      await api.openCustomNodeScript(resolved.scope, resolved.def.id, workspacePath);
    } catch (err) {
      setError(String(err));
    } finally {
      setOpening(false);
    }
  };

  if (!resolved) {
    return (
      <div className="border-t border-border-subtle pt-4 text-[11px] text-text-muted">
        Script definition is not loaded in this workspace.
      </div>
    );
  }

  const { def } = resolved;
  const danglingCreds = (def.credentials ?? []).filter((c) => !availableCredIds.has(c));

  return (
    <div className="flex flex-col gap-3">
      <InspectorActions defaultOpen={true} onDeleteNode={onDeleteNode}>
        <button
          type="button"
          onClick={handleOpen}
          disabled={opening}
          title="Create script.js if missing, then open it in your default editor"
          className="w-full bg-card hover:bg-card-hover border border-border-subtle hover:border-border-card text-text-main rounded-md py-2 text-xs font-semibold cursor-pointer transition-colors flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>📝</span>
          <span>{opening ? "Opening…" : "Open script in editor"}</span>
        </button>

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger">
            {error}
          </div>
        )}

        {danglingCreds.length > 0 && (
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">⚠️</span>
              <span className="text-[11px] uppercase tracking-widest font-bold text-warning">
                Missing credential grant{danglingCreds.length > 1 ? "s" : ""}
              </span>
            </div>
            <p className="text-[11px] text-text-secondary leading-relaxed m-0">
              This script grants {danglingCreds.length} credential
              {danglingCreds.length > 1 ? "s" : ""} that don't resolve on this machine (credential ids
              don't travel when a node is promoted or moved between machines). Any{" "}
              <span className="font-mono">fetch</span> using them will fail until you re-grant a local
              credential in the node editor.
            </p>
            <div className="flex flex-wrap gap-1">
              {danglingCreds.map((c) => (
                <span
                  key={c}
                  className="text-[10px] font-mono text-warning/90 bg-input border border-border-subtle rounded px-1.5 py-0.5"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
      </InspectorActions>

      {def.configSchema.length > 0 && (
        <CollapsibleSection title="Configuration" icon="⚙️" defaultOpen={true}>
          <div className="flex flex-col gap-3">
            {def.configSchema.map((field) => (
              <ConfigField
                key={field.key}
                field={field}
                value={node.data?.[field.key]}
                onChange={(next) => onUpdate(node.id, { ...node.data, [field.key]: next })}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      <button
        className={`w-full border border-accent text-accent rounded-md py-2.5 text-sm font-semibold cursor-pointer transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
          isRunning
            ? "bg-accent text-primary shadow-[0_0_12px_rgba(212,230,0,0.3)]"
            : "bg-card hover:bg-accent hover:text-primary hover:shadow-[0_0_12px_rgba(212,230,0,0.3)]"
        }`}
        onClick={() => onRun && onRun(node.id)}
        disabled={isRunning}
      >
        {isRunning ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Running…
          </>
        ) : (
          <>▶ Run from this node</>
        )}
      </button>

      <CollapsibleSection
        title="Output"
        icon="📤"
        defaultOpen={hasOutput}
        badge={hasOutput ? output!.length : undefined}
      >
        <DataConsole content={output} placeholder="No output yet." />
      </CollapsibleSection>

      <CollapsibleSection
        title="Logs"
        icon="📋"
        defaultOpen={false}
        badge={logs.length > 0 ? logs.length : undefined}
      >
        <DataConsole
          content={logs.length > 0 ? logs.join("\n") : undefined}
          placeholder="No log output."
        />
      </CollapsibleSection>
    </div>
  );
}
