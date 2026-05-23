import { useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";
import { NODE_REGISTRY } from "@/nodes/registry";
import { getConnectionBehavior } from "@/engine/connectivity";
import { getUpstreamNodeEnvelope } from "@/engine/utils";
import DataConsole from "./shared/DataConsole";
import DatabaseRecordFeed from "./shared/DatabaseRecordFeed";

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

  const sourceDef = NODE_REGISTRY.find((d) => d.type === sourceNode.type);
  const targetDef = NODE_REGISTRY.find((d) => d.type === targetNode.type);
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
    const records = (storageNode.data?.records as any[]) || [];

    contentNodes = (
      <div className="flex flex-col gap-4">
        {showRead && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-text-secondary select-none">
              📖 Read ({storageNodeLabel} ➔ {logicNodeLabel})
            </label>
            <DatabaseRecordFeed records={records} />
          </div>
        )}

        {showWrite && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-text-secondary select-none">
              ✍️ Write ({logicNodeLabel} ➔ {storageNodeLabel})
            </label>
            <DataConsole content={writePayload} placeholder="No output data written yet." />
          </div>
        )}
      </div>
    );
  } else {
    // Non-storage triggers / standard logic
    const targetEnvelope = getUpstreamNodeEnvelope(targetNode);
    const targetOutput = targetEnvelope.metadata?.generatedFallback ? targetEnvelope.value : JSON.stringify(targetEnvelope, null, 2);
    const showBiDirectional = edgeType === "bi-directional";

    const isChatToOllama = sourceNode.type === "chat" && targetNode.type === "ollama";

    if (isChatToOllama) {
      const systemPrompt = String(targetNode.data?.systemPrompt || "");
      const historyLimit = Number(targetNode.data?.chatHistoryLimit || 0);
      const rawMessages = (sourceNode.data?.messages as any[]) || [];

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
              💬 Exact Prompt Package Sent to Ollama
            </label>
            <DataConsole content={formattedJson} placeholder="No messages prepared yet." />
          </div>

          {showBiDirectional && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-text-secondary select-none">
                📥 Return Payload ({targetNodeLabel} ➔ {sourceNodeLabel})
              </label>
              <DataConsole content={targetOutput} placeholder="No response payload transmitted yet." />
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
            <DataConsole content={sourceOutput} placeholder="No output payload transmitted yet." />
          </div>

          {showBiDirectional && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-text-secondary select-none">
                📥 Return Payload ({targetNodeLabel} ➔ {sourceNodeLabel})
              </label>
              <DataConsole content={targetOutput} placeholder="No response payload transmitted yet." />
            </div>
          )}
        </div>
      );
    }
  }

  return (
    <>
      {/* Header */}
      <div className="p-4 border-b border-border-subtle bg-card/60 backdrop-blur-md flex flex-col gap-1.5 select-none">
        <div className="flex items-center justify-between gap-2">
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
              badgeColorClass = "text-[#38bdf8] bg-[#38bdf8]/5 border-[#38bdf8]/20";
            } else if (edgeType === "read-only") {
              badgeLabel = "Read-Only Context";
              badgeColorClass = "text-[#38bdf8] bg-[#38bdf8]/5 border-[#38bdf8]/20";
            } else if (edgeType === "write-only") {
              badgeLabel = "Write-Only Output";
              badgeColorClass = "text-[#38bdf8] bg-[#38bdf8]/5 border-[#38bdf8]/20";
            }

            return (
              <span className={`text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${badgeColorClass}`}>
                {badgeLabel}
              </span>
            );
          })()}
        </div>
        <span className="text-[10px] text-text-secondary leading-normal">
          Inspect active data routing pipelines and configure connection behaviors.
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6 scrollbar-thin">
        {/* 1. Source & Target Routing Pathway Visualizer */}
        <div className="flex flex-col gap-2.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#71717a] select-none">Routing Pathway</label>

          <div className="relative bg-[#0b0b0d]/70 border border-[#222] rounded-xl p-3.5 flex flex-col gap-3 overflow-hidden shadow-inner">
            {/* Decorative grid backdrop */}
            <div className="absolute inset-0 opacity-[0.015] pointer-events-none bg-[radial-gradient(#d4e600_1px,transparent_1px)] bg-size-[16px_16px]"></div>

            <div className="flex items-center justify-between gap-3 z-10 relative">
              {/* Source Node Card */}
              <div className="flex-1 flex flex-col items-center justify-center min-w-0 bg-[#16161a] border border-[#2c2c34] rounded-lg p-2 shadow-sm text-center">
                <span className="text-lg select-none mb-1 filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]">
                  {sourceDef?.icon || "⚪"}
                </span>
                <span className="text-[11px] font-bold text-[#f4f4f5] truncate w-full" title={String(sourceNode.data?.label || sourceDef?.label || sourceNode.type)}>
                  {String(sourceNode.data?.label || sourceDef?.label || sourceNode.type)}
                </span>
                <span className="text-[8px] uppercase font-mono tracking-wider text-[#52525b] mt-0.5 px-1 py-px bg-[#1e1e24] rounded border border-[#2e2e38]/30">
                  {sourceNode.type}
                </span>
              </div>

              {/* Animated Flow Connector */}
              <div className="flex flex-col items-center justify-center shrink-0 w-10 select-none relative">
                <span className={`text-base leading-none filter drop-shadow-[0_0_4px_rgba(212,230,0,0.4)] ${isDatabase ? "text-[#38bdf8]" : "text-accent"} ${isReverse ? "rotate-180" : ""}`}>➔</span>
                <div className="w-8 h-0.5 bg-[#222] mt-1 relative overflow-hidden rounded-full border-t border-[#333]">
                  <div
                    className="absolute top-0 h-full w-2.5 rounded-full animate-[flowDash_1.6s_linear_infinite]"
                    style={{
                      background: isDatabase
                        ? "linear-gradient(90deg, transparent, #38bdf8, transparent)"
                        : "linear-gradient(90deg, transparent, #d4e600, transparent)",
                      animationDirection: isReverse ? "reverse" : "normal"
                    }}
                  ></div>
                </div>
              </div>

              {/* Target Node Card */}
              <div className="flex-1 flex flex-col items-center justify-center min-w-0 bg-[#16161a] border border-[#2c2c34] rounded-lg p-2 shadow-sm text-center">
                <span className="text-lg select-none mb-1 filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]">
                  {targetDef?.icon || "⚪"}
                </span>
                <span className="text-[11px] font-bold text-[#f4f4f5] truncate w-full" title={String(targetNode.data?.label || targetDef?.label || targetNode.type)}>
                  {String(targetNode.data?.label || targetDef?.label || targetNode.type)}
                </span>
                <span className="text-[8px] uppercase font-mono tracking-wider text-[#52525b] mt-0.5 px-1 py-px bg-[#1e1e24] rounded border border-[#2e2e38]/30">
                  {targetNode.type}
                </span>
              </div>
            </div>

            {/* Routing Details Footer */}
            <div className="flex justify-between items-center text-[8px] font-mono text-text-muted border-t border-[#1b1b1f] pt-2 mt-1 z-10 select-none">
              <span className="truncate max-w-[45%]">ID: {selectedEdge.source}</span>
              <span className="truncate max-w-[45%] text-right">ID: {selectedEdge.target}</span>
            </div>
          </div>
        </div>

        {/* 2. Data Flow Debugger */}
        <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#71717a] flex items-center gap-1.5 select-none">
            <span>🔍</span>
            <span>Live Connection Data</span>
          </div>
          {contentNodes}
        </div>

        {/* 3. Edge Type Customization */}
        <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#71717a] select-none">
            {["database", "database-read", "database-write"].includes(connectionBehavior.allowedOption)
              ? "Database Permissions"
              : "Connection Type"}
          </label>

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
                          ? "bg-[#38bdf8]/10 border-[#38bdf8] text-text-main shadow-[0_0_12px_rgba(56,189,248,0.12)]"
                          : "bg-card/40 border-border-card text-text-muted hover:bg-card-hover hover:border-border-subtle"
                      }`}
                    >
                      <span className="text-base select-none mt-0.5">{t.icon}</span>
                      <div className="flex flex-col min-w-0 grow">
                        <div className="flex items-center gap-1.5 justify-between">
                          <span className={`font-semibold ${isSelected ? "text-[#38bdf8]" : "text-text-main"}`}>
                            {t.label}
                          </span>
                          <span className={`text-[10px] font-mono select-none ${isSelected ? "text-[#38bdf8]" : "text-[#52525b]"}`}>
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
                          <span className={`text-[10px] font-mono select-none ${isSelected ? "text-accent" : "text-[#52525b]"}`}>
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
            <div className="text-[9px] text-[#52525b] italic px-1 flex items-center gap-1 select-none">
              <span>ℹ️</span>
              <span>Pathway constraint determined by connected nodes.</span>
            </div>
          )}
        </div>

        {/* 4. Delete Connection */}
        <div className="mt-auto border-t border-border-subtle pt-4">
          <button
            type="button"
            onClick={() => onDeleteEdge?.(selectedEdge.id)}
            className="w-full bg-[#1c0e0e]/40 hover:bg-[#ef4444]/15 border border-[#ef4444]/20 hover:border-[#ef4444]/40 text-[#fca5a5] hover:text-[#f87171] rounded-lg py-2.5 px-4 text-xs font-semibold tracking-wider uppercase transition-all flex items-center justify-center gap-2 cursor-pointer duration-200 active:scale-[0.98]"
          >
            <span>🗑️</span>
            <span>Delete Connection</span>
          </button>
        </div>
      </div>
    </>
  );
}
