import { useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { getConnectionBehavior } from "@/engine/connectivity";
import { getUpstreamNodeEnvelope } from "@/engine/utils";
import DataConsole from "./shared/DataConsole";
import DatabaseRecordFeed from "./shared/DatabaseRecordFeed";
import CollapsibleSection from "./CollapsibleSection";
import { getChatMessages, getStorageRecords } from "@/engine/nodeData";

// ─── Props ───────────────────────────────────────────────────
interface ConnectionInspectorProps {
  selectedEdge: Edge;
  nodes: Node[];
  onUpdateEdgeData?: (edgeId: string, edgeType: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
}

// ─── Connection Inspector ────────────────────────────────────
export default function ConnectionInspector({
  selectedEdge,
  nodes,
  onUpdateEdgeData,
  onDeleteEdge,
}: ConnectionInspectorProps) {
  const sourceNode = useMemo(() => {
    if (!selectedEdge || !nodes) return null;
    return nodes.find((n) => n.id === selectedEdge.source) || null;
  }, [selectedEdge, nodes]);

  const targetNode = useMemo(() => {
    if (!selectedEdge || !nodes) return null;
    return nodes.find((n) => n.id === selectedEdge.target) || null;
  }, [selectedEdge, nodes]);

  const connectionBehavior = useMemo(() => {
    if (!sourceNode || !targetNode) {
      return { allowedOption: "one-way" as const, defaultFlow: "one-way" as const };
    }
    return getConnectionBehavior(
      sourceNode.type,
      targetNode.type,
      selectedEdge?.sourceHandle,
      selectedEdge?.targetHandle
    );
  }, [sourceNode, targetNode, selectedEdge]);

  if (!sourceNode || !targetNode) return null;

  const sourcePlugin = pluginRegistry.get(sourceNode.type || '');
  const targetPlugin = pluginRegistry.get(targetNode.type || '');
  const edgeType = (selectedEdge.data?.edgeType as string) || connectionBehavior.defaultFlow;
  const isDatabase = ["read-only", "write-only", "read-write"].includes(edgeType);
  const isReverse = edgeType === "read-only" && targetNode.type === "jsonStorage";

  const sourceNodeLabel = String(sourceNode.data?.label || sourceNode.type);
  const targetNodeLabel = String(targetNode.data?.label || targetNode.type);

  const isSourceStorage = sourceNode.type === "jsonStorage";
  const isTargetStorage = targetNode.type === "jsonStorage";
  const hasStorage = isSourceStorage || isTargetStorage;

  let contentNodes: React.ReactNode = null;

  if (hasStorage) {
    const storageNode = isSourceStorage ? sourceNode : targetNode;
    const logicNode = isSourceStorage ? targetNode : sourceNode;
    const storageNodeLabel = String(storageNode.data?.label || "Storage");
    const logicNodeLabel = String(logicNode.data?.label || "Node");

    const showRead = edgeType === "read-only" || edgeType === "read-write";
    const showWrite = edgeType === "write-only" || edgeType === "read-write";

    const writeEnvelope = getUpstreamNodeEnvelope(logicNode);
    const writePayload = writeEnvelope.metadata?.generatedFallback ? writeEnvelope.value : JSON.stringify(writeEnvelope, null, 2);
    const records = getStorageRecords(storageNode.data);

    contentNodes = (
      <div className="flex flex-col gap-4">
        {showRead && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-text-secondary select-none">
              📖 Read ({storageNodeLabel} ➔ {logicNodeLabel})
            </label>
            <DatabaseRecordFeed records={records} maxHeight="" />
          </div>
        )}

        {showWrite && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-text-secondary select-none">
              ✍️ Write ({logicNodeLabel} ➔ {storageNodeLabel})
            </label>
            <DataConsole content={writePayload} placeholder="No output data written yet." maxHeight="" />
          </div>
        )}
      </div>
    );
  } else {
    // Non-storage triggers / standard logic
    const targetEnvelope = getUpstreamNodeEnvelope(targetNode);
    const targetOutput = targetEnvelope.metadata?.generatedFallback ? targetEnvelope.value : JSON.stringify(targetEnvelope, null, 2);
    const showBiDirectional = edgeType === "bi-directional";

    const isChatToOllama = sourceNode.type === "chat" && (targetNode.type === "ollama" || targetNode.type === "llm");

    if (isChatToOllama) {
      const systemPrompt = String(targetNode.data?.systemPrompt || "");
      const historyLimit = Number(targetNode.data?.chatHistoryLimit || 0);
      const rawMessages = getChatMessages(sourceNode.data);

      let ollamaMsgs = [...rawMessages];
      if (historyLimit > 0 && ollamaMsgs.length > historyLimit) {
        ollamaMsgs = ollamaMsgs.slice(-historyLimit);
      }
      if (systemPrompt.trim() !== "") {
        ollamaMsgs.unshift({ role: "system", content: systemPrompt });
      }

      const chatEnvelope = getUpstreamNodeEnvelope(sourceNode);
      const exactEnvelope = {
        value: chatEnvelope.value,
        metadata: {
          ...chatEnvelope.metadata,
          systemPromptConfigured: systemPrompt.trim() !== "",
          historyLimitApplied: historyLimit
        },
        data: ollamaMsgs
      };

      const formattedJson = JSON.stringify(exactEnvelope, null, 2);

      contentNodes = (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-text-secondary select-none">
              💬 Exact Prompt Package Sent to LLM
            </label>
            <DataConsole content={formattedJson} placeholder="No messages prepared yet." maxHeight="" />
          </div>

          {showBiDirectional && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-text-secondary select-none">
                📥 Return Payload ({targetNodeLabel} ➔ {sourceNodeLabel})
              </label>
              <DataConsole content={targetOutput} placeholder="No response payload transmitted yet." maxHeight="" />
            </div>
          )}
        </div>
      );
    } else {
      const sourceEnvelope = getUpstreamNodeEnvelope(sourceNode);
      const sourceOutput = sourceEnvelope.metadata?.generatedFallback ? sourceEnvelope.value : JSON.stringify(sourceEnvelope, null, 2);
      contentNodes = (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-text-secondary select-none">
              📤 Transmitted Payload ({sourceNodeLabel} ➔ {targetNodeLabel})
            </label>
            <DataConsole content={sourceOutput} placeholder="No output payload transmitted yet." maxHeight="" />
          </div>

          {showBiDirectional && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-text-secondary select-none">
                📥 Return Payload ({targetNodeLabel} ➔ {sourceNodeLabel})
              </label>
              <DataConsole content={targetOutput} placeholder="No response payload transmitted yet." maxHeight="" />
            </div>
          )}
        </div>
      );
    }
  }

  return (
    <>
      {/* Header */}
      <div className="p-4 border-b border-border-subtle bg-card/60 backdrop-blur-md flex items-center justify-between gap-2 select-none">
        <h2 className="text-sm font-semibold m-0 text-text-main flex items-center gap-2">
          <span>🔗</span>
          <span>Connection Inspector</span>
        </h2>
        {/* Dynamic status pill */}
        {(() => {
          let badgeLabel = "One-Way Flow";
          let badgeColorClass = "text-accent bg-accent-glow/5 border-accent/20";

          if (edgeType === "bi-directional") {
            badgeLabel = "Bi-Directional Sync";
            badgeColorClass = "text-accent bg-accent-glow/5 border-accent/20";
          } else if (edgeType === "read-write") {
            badgeLabel = "Read & Write Sync";
            badgeColorClass = "text-info bg-info/5 border-info/20";
          } else if (edgeType === "read-only") {
            badgeLabel = "Read-Only Context";
            badgeColorClass = "text-info bg-info/5 border-info/20";
          } else if (edgeType === "write-only") {
            badgeLabel = "Write-Only Output";
            badgeColorClass = "text-info bg-info/5 border-info/20";
          }

          return (
            <span className={`text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${badgeColorClass}`}>
              {badgeLabel}
            </span>
          );
        })()}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 pb-32 flex flex-col gap-3 scrollbar-thin">
        {/* 1. Source & Target Routing Pathway Visualizer */}
        <CollapsibleSection title="Routing Pathway" icon="🛰️" defaultOpen={true}>
          <div className="relative bg-primary/70 border border-border-subtle rounded-xl p-2.5 flex flex-col gap-2 overflow-hidden shadow-inner">
            <div className="flex items-center justify-between gap-2">
              {/* Source Node Card */}
              <div className="flex-1 flex flex-col items-center justify-center min-w-0 bg-card border border-border-card rounded-lg p-2.5 shadow-sm text-center">
                <span className="text-xl select-none mb-1 filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]">
                  {sourcePlugin?.meta.icon || "⚪"}
                </span>
                <span className="text-[11px] font-bold text-text-main truncate w-full" title={String(sourceNode.data?.label || sourcePlugin?.meta.label || sourceNode.type)}>
                  {String(sourceNode.data?.label || sourcePlugin?.meta.label || sourceNode.type)}
                </span>
                <span className="text-[8px] uppercase font-mono tracking-wider text-text-muted mt-0.5 px-1 py-px bg-input rounded border border-border-subtle/30">
                  {sourceNode.type}
                </span>
              </div>

              {/* Static Flow Arrow */}
              <div className="flex items-center justify-center shrink-0 w-7 select-none">
                <span className={`text-lg leading-none filter drop-shadow-[0_0_4px_var(--accent-glow)] ${isDatabase ? "text-info" : "text-accent"} ${isReverse ? "rotate-180" : ""}`}>➔</span>
              </div>

              {/* Target Node Card */}
              <div className="flex-1 flex flex-col items-center justify-center min-w-0 bg-card border border-border-card rounded-lg p-2.5 shadow-sm text-center">
                <span className="text-xl select-none mb-1 filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]">
                  {targetPlugin?.meta.icon || "⚪"}
                </span>
                <span className="text-[11px] font-bold text-text-main truncate w-full" title={String(targetNode.data?.label || targetPlugin?.meta.label || targetNode.type)}>
                  {String(targetNode.data?.label || targetPlugin?.meta.label || targetNode.type)}
                </span>
                <span className="text-[8px] uppercase font-mono tracking-wider text-text-muted mt-0.5 px-1 py-px bg-input rounded border border-border-subtle/30">
                  {targetNode.type}
                </span>
              </div>
            </div>

            {/* Routing Details Footer */}
            <div className="flex justify-between items-center text-[8px] font-mono text-text-muted border-t border-border-subtle pt-2 mt-1 z-10 select-none">
              <span className="truncate max-w-[45%]">ID: {selectedEdge.source}</span>
              <span className="truncate max-w-[45%] text-right">ID: {selectedEdge.target}</span>
            </div>
          </div>
        </CollapsibleSection>

        {/* 2. Edge Type Customization (moved above Live Connection Data) */}
        <CollapsibleSection
          title={
            ["database", "database-read", "database-write"].includes(connectionBehavior.allowedOption)
              ? "Database Permissions"
              : "Connection Type"
          }
          icon={
            ["database", "database-read", "database-write"].includes(connectionBehavior.allowedOption)
              ? "🗝️"
              : "⚡"
          }
          defaultOpen={true}
        >
          <div className="flex flex-col gap-2">
            {["database", "database-read", "database-write"].includes(connectionBehavior.allowedOption) ? (
              [
                {
                  id: "write-only",
                  label: "Write-Only Link",
                  desc: "Allows saving output payloads directly into database records.",
                  icon: "💾",
                },
                {
                  id: "read-only",
                  label: "Read-Only Context",
                  desc: "Allows querying database records as upstream context.",
                  icon: "⚡",
                },
                {
                  id: "read-write",
                  label: "Read & Write Sync",
                  desc: "Maintains full two-way state synchronization with storage.",
                  icon: "🔄",
                },
              ]
                .filter((t) => {
                  if (connectionBehavior.allowedOption === "database-read") {
                    return t.id === "read-only";
                  }
                  if (connectionBehavior.allowedOption === "database-write") {
                    return t.id === "write-only";
                  }
                  return true;
                })
                .map((t) => {
                  const isSelected = (selectedEdge.data?.edgeType || "read-write") === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onUpdateEdgeData?.(selectedEdge.id, t.id)}
                      className={`flex items-start text-left gap-3.5 p-3 rounded-lg border text-xs transition-all duration-150 cursor-pointer ${
                        isSelected
                          ? "bg-info/10 border-info text-text-main shadow-[0_0_12px_rgba(56,189,248,0.12)]"
                          : "bg-card/40 border-border-card text-text-muted hover:bg-card-hover hover:border-border-subtle"
                      }`}
                    >
                      <span className="text-base select-none mt-0.5">{t.icon}</span>
                      <div className="flex flex-col min-w-0 grow">
                        <div className="flex items-center gap-1.5 justify-between">
                          <span className={`font-semibold ${isSelected ? "text-info" : "text-text-main"}`}>
                            {t.label}
                          </span>
                          <span className={`text-[10px] font-mono select-none ${isSelected ? "text-info" : "text-text-muted"}`}>
                            {isSelected ? "● ACTIVE" : "○ SELECT"}
                          </span>
                        </div>
                        <span className="text-[10.5px] text-text-secondary mt-1 leading-normal font-normal">
                          {t.desc}
                        </span>
                      </div>
                    </button>
                  );
                })
            ) : (
              [
                {
                  id: "one-way",
                  label: "One-Way Trigger Flow",
                  desc: "Standard sequential trigger path. Dash animated flow runs forward.",
                  icon: "⚡",
                },
                {
                  id: "bi-directional",
                  label: "Bi-Directional Sync",
                  desc: "Dual flow pathways moving in both directions. Ideal for agent loops.",
                  icon: "🔄",
                },
              ]
                .filter((t) => {
                  if (connectionBehavior.allowedOption === "one-way") {
                    return t.id === "one-way";
                  }
                  if (connectionBehavior.allowedOption === "bi-directional") {
                    return t.id === "bi-directional";
                  }
                  return true;
                })
                .map((t) => {
                  const isSelected = (selectedEdge.data?.edgeType || "one-way") === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onUpdateEdgeData?.(selectedEdge.id, t.id)}
                      className={`flex items-start text-left gap-3.5 p-3 rounded-lg border text-xs transition-all duration-150 cursor-pointer ${
                        isSelected
                          ? "bg-accent-glow/10 border-accent text-text-main shadow-[0_0_12px_rgba(212,230,0,0.06)]"
                          : "bg-card/40 border-border-card text-text-muted hover:bg-card-hover hover:border-border-subtle"
                      }`}
                    >
                      <span className="text-base select-none mt-0.5">{t.icon}</span>
                      <div className="flex flex-col min-w-0 grow">
                        <div className="flex items-center gap-1.5 justify-between">
                          <span className={`font-semibold ${isSelected ? "text-accent" : "text-text-main"}`}>
                            {t.label}
                          </span>
                          <span className={`text-[10px] font-mono select-none ${isSelected ? "text-accent" : "text-text-muted"}`}>
                            {isSelected ? "● ACTIVE" : "○ SELECT"}
                          </span>
                        </div>
                        <span className="text-[10.5px] text-text-secondary mt-1 leading-normal font-normal">
                          {t.desc}
                        </span>
                      </div>
                    </button>
                  );
                })
            )}
          </div>
          {connectionBehavior.allowedOption !== "both" && (
            <div className="text-[9px] text-text-muted italic px-1 flex items-center gap-1 select-none mt-2">
              <span>ℹ️</span>
              <span>Pathway constraint determined by connected nodes.</span>
            </div>
          )}
        </CollapsibleSection>

        {/* 3. Live Connection Data (moved after Edge Type, edge-to-edge) */}
        <CollapsibleSection
          title="Live Connection Data"
          icon="🔍"
          defaultOpen={true}
          flush={true}
        >
          <div className="px-3.5 pb-3.5">{contentNodes}</div>
        </CollapsibleSection>

        {/* 4. Actions */}
        <CollapsibleSection title="Actions" icon="⚙️" defaultOpen={false}>
          <button
            type="button"
            onClick={() => onDeleteEdge?.(selectedEdge.id)}
            className="w-full bg-danger/10 hover:bg-danger/20 border border-danger/30 hover:border-danger/50 text-danger hover:text-danger-hover rounded-md py-2 text-xs font-semibold cursor-pointer transition-colors flex justify-center items-center gap-2"
          >
            <span>🗑️</span>
            <span>Delete Connection</span>
          </button>
        </CollapsibleSection>
      </div>
    </>
  );
}
