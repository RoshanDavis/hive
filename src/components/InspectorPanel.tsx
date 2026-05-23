import { useState, useMemo, useEffect } from "react";
import type { Node, Edge } from "@xyflow/react";
import { NODE_REGISTRY, type NodeDefinition } from "../nodes/types";
import { getConnectionBehavior } from "../engine/connectivity";
import { getUpstreamNodeEnvelope } from "../engine/utils";

// ─── DataConsole Helper for Code/Text Payloads ───────────────────
function DataConsole({ content, placeholder = "No data transmitted yet." }: { content: string | null | undefined; placeholder?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const hasData = content !== null && content !== undefined;
  const isEmpty = content === "";

  let displayVal = placeholder;
  if (hasData) {
    displayVal = isEmpty ? '"" (empty string)' : content;
  }

  return (
    <div className="bg-[#0b0b0d]/70 border border-[#222] rounded-lg p-3 font-mono text-[11px] leading-relaxed text-[#e4e4e7] overflow-x-auto relative group max-h-[140px] overflow-y-auto pr-10 scrollbar-thin select-text">
      {hasData && !isEmpty && (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 hover:bg-[#1e1e24] text-[#a1a1aa] hover:text-white text-[9px] px-1.5 py-0.5 rounded border border-[#2e2e38]/30 transition-all select-none cursor-pointer duration-150"
        >
          {copied ? "✓ Copied" : "📋 Copy"}
        </button>
      )}
      <pre className={`m-0 whitespace-pre-wrap break-all ${!hasData || isEmpty ? "text-text-secondary/60 italic" : ""}`}>
        {displayVal}
      </pre>
    </div>
  );
}

// ─── DatabaseRecordFeed Helper for JSON storage record logs ──────
function DatabaseRecordFeed({ records }: { records: any[] }) {
  if (!records || records.length === 0) {
    return (
      <div className="bg-[#0b0b0d]/70 border border-[#222] rounded-lg p-3 text-center text-[11px] text-text-secondary/60 italic select-none">
        No records stored yet.
      </div>
    );
  }

  return (
    <div className="bg-[#0b0b0d]/70 border border-[#222] rounded-lg p-3 max-h-[160px] overflow-y-auto font-mono text-[11px] leading-relaxed text-[#e4e4e7] scrollbar-thin select-text flex flex-col gap-1">
      {records.map((rec, idx) => {
        const time = rec.timestamp || "--:--:--";
        const source = rec.source || "Unknown";
        const content = rec.content || "";
        const sourceLower = source.toLowerCase();

        let sourceColor = "text-[#888888]"; // Default
        if (sourceLower === "user" || sourceLower === "you") {
          sourceColor = "text-[#34d399]"; // User green
        } else if (sourceLower === "system") {
          sourceColor = "text-[#818cf8]"; // System purple-blue
        } else if (sourceLower.includes("ollama") || sourceLower.includes("robot")) {
          sourceColor = "text-[#c084fc]"; // AI Ollama purple
        } else if (sourceLower.includes("notify")) {
          sourceColor = "text-[#60a5fa]"; // Notify blue
        }

        return (
          <div key={rec.id || idx} className="py-0.5 border-b border-[#222]/10 last:border-0 hover:bg-[#1a1a24]/10 rounded px-1 select-text">
            <span className="text-[#52525b] mr-1">[{time}]</span>
            <span className={`${sourceColor} font-semibold mr-1.5`}>[{source}]</span>
            <span className="text-[#d4d4d8]">{content}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────
interface InspectorPanelProps {
  selectedNode: Node | null;
  onAddNode: (definition: NodeDefinition) => void;
  onUpdateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  onRunWorkflow: (triggerNodeId?: string) => void;
  onChatSend?: (nodeId: string, text: string) => void;
  onRetryWorkflow?: (nodeId: string) => void;
  isRunning: boolean;
  nodes?: Node[];
  edges?: Edge[];
  onDragStartNode?: (type: string) => void;
  onDragEndNode?: () => void;
  selectedEdge: Edge | null;
  onUpdateEdgeData?: (edgeId: string, edgeType: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
}

// ─── Inspector Panel ─────────────────────────────────────────
export default function InspectorPanel({
  selectedNode,
  onAddNode,
  onUpdateNodeData,
  onRunWorkflow,
  onChatSend,
  onRetryWorkflow,
  isRunning,
  nodes,
  edges,
  onDragStartNode,
  onDragEndNode,
  selectedEdge,
  onUpdateEdgeData,
  onDeleteEdge,
}: InspectorPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem("hive-inspector-width");
    return saved ? parseInt(saved, 10) : 320;
  });
  const [isResizing, setIsResizing] = useState(false);

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

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleDoubleClick = () => {
    setWidth(320);
    localStorage.setItem("hive-inspector-width", "320");
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Inspector is docked to the right edge, so width grows as mouse moves left (smaller clientX)
      const newWidth = window.innerWidth - e.clientX;
      const boundedWidth = Math.max(280, Math.min(newWidth, 800));
      setWidth(boundedWidth);
      localStorage.setItem("hive-inspector-width", String(boundedWidth));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const handleDragStart = (event: React.DragEvent, nodeType: string) => {
    if (event.dataTransfer) {
      event.dataTransfer.setData("application/reactflow", nodeType);
      event.dataTransfer.effectAllowed = "move";

      // Hide the browser's default semi-transparent drag ghost image completely
      const img = new Image();
      img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      event.dataTransfer.setDragImage(img, 0, 0);
    }
    if (onDragStartNode) {
      onDragStartNode(nodeType);
    }
  };

  const filteredNodes = useMemo(() => {
    const baseList = NODE_REGISTRY.filter(d => d.type !== "output");
    const query = searchQuery.trim().toLowerCase();
    if (!query) return baseList;

    return baseList.map((def) => {
      const label = def.label.toLowerCase();
      const desc = def.description.toLowerCase();

      let score = 0;
      if (label === query) {
        score = 100; // Exact match
      } else if (label.startsWith(query)) {
        score = 80; // Prefix match
      } else if (label.includes(query)) {
        score = 60; // Substring match in label
      } else if (desc.includes(query)) {
        score = 40; // Substring match in description
      }

      return { def, score };
    })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.def);
  }, [searchQuery]);

  return (
    <div
      className="relative bg-sidebar border-l border-border-subtle flex flex-col z-10 shrink-0"
      id="inspector-panel"
      style={{ width: `${width}px` }}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        className="absolute top-0 bottom-0 left-0 w-1.5 -ml-[3px] cursor-col-resize select-none z-50 group"
        title="Double-click to reset width"
      >
        <div
          className={`absolute top-0 bottom-0 left-[2px] w-[2px] transition-colors duration-150 h-full ${
            isResizing
              ? "bg-accent shadow-[0_0_8px_rgba(212,230,0,0.8)]"
              : "bg-transparent group-hover:bg-accent-dim/60"
          }`}
        />
      </div>

      {selectedNode ? (
        <>
          <div className="p-4 border-b border-border-subtle bg-card flex flex-col gap-1">
            <h2 className="text-base font-semibold m-0 text-text-main flex items-center gap-2">
              {selectedNode.type === "trigger" ? "⚡" : ""}
              {selectedNode.type === "notify" ? "🔔" : ""}
              {selectedNode.type === "ollama" ? "🤖" : ""}
              {selectedNode.type === "chat" ? "💬" : ""}
              {selectedNode.type === "output" || selectedNode.type === "outputNode" ? "📤" : ""}
              {selectedNode.type === "jsonStorage" ? "💾" : ""}
              {" "}
              {String(selectedNode.data?.label || selectedNode.type)}
            </h2>
            <span className="text-[10px] uppercase tracking-widest font-bold text-accent bg-accent-glow self-start px-2 py-0.5 rounded-sm">{selectedNode.type}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
            {/* Error Message & Retry Action Banner */}
            {selectedNode.data?.status === "error" && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 flex flex-col gap-3 relative overflow-hidden backdrop-blur-md">
                <div className="flex items-start gap-2.5">
                  <span className="text-lg leading-none select-none">⚠️</span>
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="text-xs uppercase tracking-widest text-red-400 font-bold">Node Execution Failed</span>
                    <p className="text-[11px] text-text-secondary leading-relaxed break-words mt-1 mb-0 whitespace-pre-wrap">
                      {String(selectedNode.data?.error || "An unknown execution error occurred.")}
                    </p>
                  </div>
                </div>
                {onRetryWorkflow && (
                  <button
                    onClick={() => onRetryWorkflow(selectedNode.id)}
                    disabled={isRunning}
                    className="w-full bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 hover:border-red-500/60 text-red-200 hover:text-white rounded-md py-2 text-xs font-semibold cursor-pointer transition-all flex justify-center items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed select-none mt-1 shadow-sm"
                  >
                    <span>🔄</span>
                    <span>Retry Execution from Node</span>
                  </button>
                )}
              </div>
            )}

            {/* Common fields */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Label</label>
              <input
                className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
                type="text"
                value={String(selectedNode.data?.label || "")}
                onChange={(e) =>
                  onUpdateNodeData(selectedNode.id, {
                    ...selectedNode.data,
                    label: e.target.value,
                  })
                }
              />
            </div>

            {/* Dynamic Component Rendering based on Registry */}
            {(() => {
              const def = NODE_REGISTRY.find(d => d.type === selectedNode.type);
              const Inspector = def?.inspector;
              if (Inspector) {
                return (
                  <Inspector
                    node={selectedNode}
                    onUpdate={onUpdateNodeData}
                    isRunning={isRunning}
                    onRun={onRunWorkflow}
                    onChatSend={onChatSend}
                    nodes={nodes}
                    edges={edges}
                  />
                );
              }
              return null;
            })()}

            {/* Position info */}
            <div className="border-t border-border-subtle pt-4 flex flex-col gap-2">
              <div className="text-[11px] uppercase tracking-widest font-bold text-text-muted mb-1">Position</div>
              <div className="flex gap-4 text-sm text-text-main font-mono">
                <span>X: {Math.round(selectedNode.position?.x || 0)}</span>
                <span>Y: {Math.round(selectedNode.position?.y || 0)}</span>
              </div>
            </div>
          </div>
        </>
      ) : selectedEdge ? (
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
                const edgeType = (selectedEdge.data?.edgeType as string) || connectionBehavior.defaultFlow;
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
            {(() => {
              if (!sourceNode || !targetNode) return null;
              const sourceDef = NODE_REGISTRY.find((d) => d.type === sourceNode.type);
              const targetDef = NODE_REGISTRY.find((d) => d.type === targetNode.type);
              const edgeType = (selectedEdge.data?.edgeType as string) || connectionBehavior.defaultFlow;
              const isDatabase = ["read-only", "write-only", "read-write"].includes(edgeType);
              const isReverse = edgeType === "read-only" && targetNode.type === "jsonStorage";
              
              return (
                <div className="flex flex-col gap-2.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#71717a] select-none">Routing Pathway</label>
                  
                  <div className="relative bg-[#0b0b0d]/70 border border-[#222] rounded-xl p-3.5 flex flex-col gap-3 overflow-hidden shadow-inner">
                    {/* Decorative grid backdrop */}
                    <div className="absolute inset-0 opacity-[0.015] pointer-events-none bg-[radial-gradient(#d4e600_1px,transparent_1px)] [background-size:16px_16px]"></div>
                    
                    <div className="flex items-center justify-between gap-3 z-10 relative">
                      {/* Source Node Card */}
                      <div className="flex-1 flex flex-col items-center justify-center min-w-0 bg-[#16161a] border border-[#2c2c34] rounded-lg p-2 shadow-sm text-center">
                        <span className="text-lg select-none mb-1 filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]">
                          {sourceDef?.icon || "⚪"}
                        </span>
                        <span className="text-[11px] font-bold text-[#f4f4f5] truncate w-full" title={String(sourceNode.data?.label || sourceDef?.label || sourceNode.type)}>
                          {String(sourceNode.data?.label || sourceDef?.label || sourceNode.type)}
                        </span>
                        <span className="text-[8px] uppercase font-mono tracking-wider text-[#52525b] mt-0.5 px-1 py-[1px] bg-[#1e1e24] rounded border border-[#2e2e38]/30">
                          {sourceNode.type}
                        </span>
                      </div>

                      {/* Animated Flow Connector */}
                      <div className="flex flex-col items-center justify-center shrink-0 w-10 select-none relative">
                        <span className={`text-base leading-none filter drop-shadow-[0_0_4px_rgba(212,230,0,0.4)] ${isDatabase ? "text-[#38bdf8]" : "text-accent"} ${isReverse ? "rotate-180" : ""}`}>➔</span>
                        <div className="w-8 h-[2px] bg-[#222] mt-1 relative overflow-hidden rounded-full border-t border-[#333]">
                          <div 
                            className={`absolute top-0 h-full w-2.5 rounded-full animate-[flowDash_1.6s_linear_infinite]`}
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
                        <span className="text-[8px] uppercase font-mono tracking-wider text-[#52525b] mt-0.5 px-1 py-[1px] bg-[#1e1e24] rounded border border-[#2e2e38]/30">
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
              );
            })()}

            {/* 2. Data Flow Debugger */}
            {(() => {
              if (!sourceNode || !targetNode) return null;

              const edgeType = (selectedEdge.data?.edgeType as string) || connectionBehavior.defaultFlow;
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
                <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-[#71717a] flex items-center gap-1.5 select-none">
                    <span>🔍</span>
                    <span>Live Connection Data</span>
                  </div>
                  {contentNodes}
                </div>
              );
            })()}

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
                          <div className="flex flex-col min-w-0 flex-grow">
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
                          <div className="flex flex-col min-w-0 flex-grow">
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
      ) : (
        <>
          <div className="p-4 border-b border-border-subtle bg-card flex flex-col gap-1">
            <h2 className="text-base font-semibold m-0 text-text-main flex items-center gap-2">Add Node</h2>
            <span className="text-[10px] uppercase tracking-widest font-bold text-accent bg-accent-glow self-start px-2 py-0.5 rounded-sm">Palette</span>
          </div>

          <div className="p-4 border-b border-border-subtle bg-primary">
            <input
              className="w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] outline-none"
              type="text"
              placeholder="Search nodes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
            {filteredNodes.length > 0 ? (
              filteredNodes.map((def) => (
                <div
                  key={def.type}
                  className="bg-card border border-border-card rounded-lg p-4 cursor-grab active:cursor-grabbing transition-all hover:bg-card-hover hover:border-accent-dim hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
                  onClick={() => onAddNode(def)}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, def.type)}
                  onDragEnd={() => {
                    if (onDragEndNode) onDragEndNode();
                  }}
                  id={`add-node-${def.type}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">{def.icon}</span>
                    <span className="font-semibold text-text-main">{def.label}</span>
                  </div>
                  <div className="text-xs text-text-muted leading-relaxed">
                    {def.description}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 text-text-muted gap-2 mt-8">
                <span className="text-2xl opacity-50">🔍</span>
                <span className="text-sm">
                  No nodes match "{searchQuery}"
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
