import { useCallback, useState, useMemo, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type OnConnect,
  type Node,
  type Edge,
  type OnSelectionChangeFunc,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { invoke } from "@tauri-apps/api/core";

import SpacesSidebar, { type SpaceEntry } from "./SpacesSidebar";
import InspectorPanel from "./InspectorPanel";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import { ToastContainer, ToastItem } from "./Toast";
import TriggerNodeComponent from "../nodes/TriggerNode";
import NotifyNodeComponent from "../nodes/NotifyNode";
import OllamaNodeComponent from "../nodes/OllamaNode";
import ChatNodeComponent from "../nodes/ChatNode";
import OutputNodeComponent from "../nodes/OutputNode";
import JSONStorageNodeComponent from "../nodes/JSONStorageNode";
import type { NodeDefinition } from "../nodes/types";
import { executeNode } from "../engine";

// ─── Props ───────────────────────────────────────────────────
interface WorkspaceEditorProps {
  workspaceName: string;
  workspacePath: string;
  onBack: () => void;
}

// ─── Custom node type registry ──────────────────────────────
const nodeTypes = {
  trigger: TriggerNodeComponent,
  notify: NotifyNodeComponent,
  ollama: OllamaNodeComponent,
  chat: ChatNodeComponent,
  output: OutputNodeComponent,
  jsonStorage: JSONStorageNodeComponent,
};

// ─── Context menu state ─────────────────────────────────────
interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

// ─── Serialized types (match Rust) ──────────────────────────
interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  source_handle?: string;
  target_handle?: string;
}

interface SpaceData {
  id: string;
  label: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: { x: number; y: number; zoom: number };
}

interface WorkspaceConfig {
  version: number;
  name: string;
  created_at: string;
  updated_at: string;
  spaces: SpaceEntry[];
  active_space: string;
}

// ─── Inner component (needs ReactFlowProvider) ──────────────
function WorkspaceEditorInner({
  workspaceName: _workspaceName,
  workspacePath,
  onBack,
}: WorkspaceEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Space management
  const [spaces, setSpaces] = useState<SpaceEntry[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  const reactFlowInstance = useReactFlow();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoadRef = useRef(true);

  // ─── Toast helper ──────────────────────────────────────────
  const showToast = useCallback(
    (message: string, type: "success" | "error" | "info") => {
      const id = Date.now();
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3500);
    },
    []
  );

  // ─── Load workspace config on mount ────────────────────────
  useEffect(() => {
    const loadConfig = async () => {
      try {
        setIsLoading(true);
        const config = await invoke<WorkspaceConfig>("load_workspace_config", {
          workspacePath,
        });
        setSpaces(config.spaces);
        const spaceToLoad = config.active_space || config.spaces[0]?.id || "space_1";
        setActiveSpaceId(spaceToLoad);
        await loadSpaceData(spaceToLoad);
      } catch (err) {
        showToast(`Failed to load workspace: ${err}`, "error");
      } finally {
        setIsLoading(false);
        // Allow auto-save after initial load settles
        setTimeout(() => {
          isInitialLoadRef.current = false;
        }, 500);
      }
    };
    loadConfig();
  }, [workspacePath]);

  // ─── Load space data ───────────────────────────────────────
  const loadSpaceData = async (spaceId: string) => {
    try {
      const data = await invoke<SpaceData>("load_space", {
        workspacePath,
        spaceId,
      });

      const loadedNodes: Node[] = data.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
      }));

      const loadedEdges: Edge[] = data.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.source_handle || undefined,
        targetHandle: e.target_handle || undefined,
        animated: true,
        style: { stroke: "#d4e600", strokeWidth: 2 },
      }));

      setNodes(loadedNodes);
      setEdges(loadedEdges);

      if (data.viewport.zoom > 0) {
        setTimeout(() => {
          reactFlowInstance.setViewport(data.viewport);
        }, 50);
      }
    } catch (err) {
      showToast(`Failed to load space: ${err}`, "error");
    }
  };

  // ─── Save current space data ───────────────────────────────
  const saveCurrentSpace = useCallback(async () => {
    if (!activeSpaceId || isInitialLoadRef.current) return;

    const viewport = reactFlowInstance.getViewport();
    const currentLabel = spaces.find((s) => s.id === activeSpaceId)?.label || activeSpaceId;

    const spaceData: SpaceData = {
      id: activeSpaceId,
      label: currentLabel,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type || "unknown",
        position: n.position,
        data: n.data as Record<string, unknown>,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        source_handle: e.sourceHandle || undefined,
        target_handle: e.targetHandle || undefined,
      })),
      viewport,
    };

    try {
      await invoke("save_space", { workspacePath, space: spaceData });
    } catch (err) {
      console.error("Auto-save failed:", err);
    }
  }, [activeSpaceId, nodes, edges, spaces, workspacePath, reactFlowInstance]);

  // ─── Debounced auto-save on changes ────────────────────────
  useEffect(() => {
    if (isInitialLoadRef.current) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveCurrentSpace();
    }, 800);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [nodes, edges, saveCurrentSpace]);

  // ─── Switch space ──────────────────────────────────────────
  const handleSwitchSpace = useCallback(
    async (newSpaceId: string) => {
      if (newSpaceId === activeSpaceId) return;

      // Save current space first
      await saveCurrentSpace();

      // Load new space
      isInitialLoadRef.current = true;
      setActiveSpaceId(newSpaceId);
      setSelectedNode(null);
      await loadSpaceData(newSpaceId);

      // Update active_space in config
      try {
        const config = await invoke<WorkspaceConfig>("load_workspace_config", {
          workspacePath,
        });
        config.active_space = newSpaceId;
        await invoke("save_workspace_config", { workspacePath, config });
      } catch (_err) {
        // Non-critical
      }

      setTimeout(() => {
        isInitialLoadRef.current = false;
      }, 500);
    },
    [activeSpaceId, saveCurrentSpace, workspacePath]
  );

  // ─── Add new space ─────────────────────────────────────────
  const handleAddSpace = useCallback(async () => {
    const newId = `space_${Date.now()}`;
    const nextOrder = spaces.length > 0 ? Math.max(...spaces.map((s) => s.order)) + 1 : 0;
    const newLabel = String(nextOrder + 1);

    try {
      await saveCurrentSpace();

      await invoke("create_space", {
        workspacePath,
        spaceId: newId,
        label: newLabel,
      });

      const newEntry: SpaceEntry = { id: newId, label: newLabel, order: nextOrder };
      setSpaces((prev) => [...prev, newEntry]);

      // Switch to the new space
      isInitialLoadRef.current = true;
      setActiveSpaceId(newId);
      setSelectedNode(null);
      setNodes([]);
      setEdges([]);
      setTimeout(() => {
        isInitialLoadRef.current = false;
      }, 500);

      showToast(`Created space ${newLabel}`, "info");
    } catch (err) {
      showToast(`Failed to create space: ${err}`, "error");
    }
  }, [spaces, workspacePath, saveCurrentSpace, setNodes, setEdges, showToast]);

  // ─── Rename space ──────────────────────────────────────────
  const handleRenameSpace = useCallback(
    async (spaceId: string, newLabel: string) => {
      setSpaces((prev) =>
        prev.map((s) => (s.id === spaceId ? { ...s, label: newLabel } : s))
      );

      // Update config
      try {
        const config = await invoke<WorkspaceConfig>("load_workspace_config", {
          workspacePath,
        });
        const space = config.spaces.find((s: SpaceEntry) => s.id === spaceId);
        if (space) {
          space.label = newLabel;
          await invoke("save_workspace_config", { workspacePath, config });
        }
      } catch (_err) {
        // Non-critical
      }
    },
    [workspacePath]
  );

  // ─── Connection handling ───────────────────────────────────
  const onConnect: OnConnect = useCallback(
    (params) =>
      setEdges((eds) =>
        addEdge(
          { ...params, animated: true, style: { stroke: "#d4e600", strokeWidth: 2 } },
          eds
        )
      ),
    [setEdges]
  );

  // ─── Selection tracking ───────────────────────────────────
  const onSelectionChange: OnSelectionChangeFunc = useCallback(
    ({ nodes: selectedNodes }) => {
      if (selectedNodes.length === 1) {
        setSelectedNode(selectedNodes[0]);
      } else {
        setSelectedNode(null);
      }
    },
    []
  );

  const currentSelectedNode = useMemo(() => {
    if (!selectedNode) return null;
    return nodes.find((n) => n.id === selectedNode.id) || null;
  }, [selectedNode, nodes]);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setContextMenu(null);
  }, []);

  // ─── Context menu: right-click node ────────────────────────
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      event.stopPropagation();

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: "Delete Node",
            icon: "🗑️",
            danger: true,
            onClick: () => {
              if (node.type === "jsonStorage") {
                invoke("delete_database_history", {
                  workspacePath,
                  spaceId: activeSpaceId,
                  databaseNodeId: node.id,
                }).catch((err) => {
                  console.error("Failed to delete JSON storage history:", err);
                });
              }
              setNodes((nds) => nds.filter((n) => n.id !== node.id));
              setEdges((eds) =>
                eds.filter((e) => e.source !== node.id && e.target !== node.id)
              );
              if (selectedNode?.id === node.id) setSelectedNode(null);
              showToast("Node deleted", "info");
            },
          },
        ],
      });
    },
    [setNodes, setEdges, selectedNode, showToast, workspacePath, activeSpaceId]
  );

  // ─── Context menu: right-click edge ────────────────────────
  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      event.stopPropagation();

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: "Delete Connection",
            icon: "✂️",
            danger: true,
            onClick: () => {
              setEdges((eds) => eds.filter((e) => e.id !== edge.id));
              showToast("Connection deleted", "info");
            },
          },
        ],
      });
    },
    [setEdges, showToast]
  );

  // Suppress browser context menu on the canvas
  const onPaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
    },
    []
  );

  // ─── Add node from palette ─────────────────────────────────
  const handleAddNode = useCallback(
    (definition: NodeDefinition) => {
      const id = `${definition.type}_${Date.now()}`;
      const offset = nodes.length * 40;
      const newNode: Node = {
        id,
        type: definition.type,
        position: { x: 200 + offset, y: 150 + offset },
        data: { ...definition.defaultData },
      };
      setNodes((prev) => [...prev, newNode]);
      showToast(`Added ${definition.label} node`, "info");
    },
    [nodes.length, setNodes, showToast]
  );

  // ─── Update node data ─────────────────────────────────────
  const handleUpdateNodeData = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...data } } : n))
      );
    },
    [setNodes]
  );

  // ─── Workflow execution ────────────────────────────────────
  const executeWorkflow = useCallback(async () => {
    const triggerNodes = nodes.filter((n) => n.type === "trigger");
    if (triggerNodes.length === 0) {
      showToast("No Trigger node found", "error");
      return;
    }

    setIsRunning(true);
    showToast("Workflow started", "info");

    try {
      const currentNodes = [...nodes];
      const localUpdateNodeData = (nodeId: string, data: Record<string, unknown>) => {
        const index = currentNodes.findIndex((n) => n.id === nodeId);
        if (index !== -1) {
          currentNodes[index] = { ...currentNodes[index], data: { ...data } };
        }
        handleUpdateNodeData(nodeId, data);
      };

      for (const trigger of triggerNodes) {
        const visited = new Set<string>();
        const queue: string[] = [trigger.id];

        while (queue.length > 0) {
          const currentId = queue.shift()!;
          if (visited.has(currentId)) continue;
          visited.add(currentId);

          const currentNode = currentNodes.find((n) => n.id === currentId);
          if (!currentNode) continue;

          await executeNode(currentNode.type || "default", {
            node: currentNode,
            nodes: currentNodes,
            edges,
            updateNodeData: localUpdateNodeData,
            showToast,
          });

          const downstream = edges
            .filter((e) => e.source === currentId)
            .map((e) => e.target);
          queue.push(...downstream);
        }
      }

      showToast("Workflow completed ✓", "success");
    } catch (err) {
      showToast(`Workflow failed: ${err}`, "error");
    } finally {
      setIsRunning(false);
    }
  }, [nodes, edges, showToast, handleUpdateNodeData]);

  // ─── Chat execution ────────────────────────────────────────
  const handleChatSend = useCallback(async (nodeId: string, text: string) => {
    const chatNode = nodes.find(n => n.id === nodeId);
    if (!chatNode) return;

    setIsRunning(true);
    try {
      const currentNodes = [...nodes];
      const localUpdateNodeData = (nodeId: string, data: Record<string, unknown>) => {
        const index = currentNodes.findIndex((n) => n.id === nodeId);
        if (index !== -1) {
          currentNodes[index] = { ...currentNodes[index], data: { ...data } };
        }
        handleUpdateNodeData(nodeId, data);
      };

      await executeNode("chat", {
        node: chatNode,
        nodes: currentNodes,
        edges,
        updateNodeData: localUpdateNodeData,
        showToast,
        chatInput: text,
        executeNode,
      });
    } finally {
      setIsRunning(false);
    }
  }, [nodes, edges, handleUpdateNodeData, showToast]);

  // ─── Back handler (save before leaving) ────────────────────
  const handleBack = useCallback(async () => {
    await saveCurrentSpace();
    onBack();
  }, [saveCurrentSpace, onBack]);

  // ─── Render ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-full w-full bg-primary overflow-hidden" id="workspace-editor">
        <div className="absolute inset-0 flex items-center justify-center bg-primary z-50">
          <div className="w-8 h-8 rounded-full border-2 border-border-subtle border-t-accent animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-primary overflow-hidden" id="workspace-editor">
      {/* Left — Spaces Sidebar */}
      <SpacesSidebar
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        onSwitchSpace={handleSwitchSpace}
        onAddSpace={handleAddSpace}
        onRenameSpace={handleRenameSpace}
        onBack={handleBack}
      />

      {/* Center — React Flow Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onPaneClick={onPaneClick}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
          defaultEdgeOptions={{
            animated: true,
            style: { stroke: "#d4e600", strokeWidth: 2 },
          }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.2}
            color="#333333"
          />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap
            position="bottom-right"
            nodeColor={(n) => {
              if (n.type === "trigger") return "#d4e600";
              if (n.type === "notify") return "#60a5fa";
              if (n.type === "ollama") return "#a78bfa";
              if (n.type === "chat") return "#34d399";
              if (n.type === "output") return "#fb923c";
              if (n.type === "jsonStorage") return "#38bdf8";
              return "#888";
            }}
            maskColor="rgba(0, 0, 0, 0.7)"
            style={{
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              borderRadius: "8px",
            }}
          />
        </ReactFlow>

        {/* Empty canvas overlay */}
        {nodes.length === 0 && (
          <div className="canvas-empty-hint">
            <span className="canvas-hint-icon">🐝</span>
            <span className="canvas-hint-text">Your canvas is empty</span>
            <span className="canvas-hint-sub">
              Add nodes from the panel on the right to get started
            </span>
          </div>
        )}
      </div>

      {/* Right — Inspector Panel */}
      <InspectorPanel
        selectedNode={currentSelectedNode}
        onAddNode={handleAddNode}
        onUpdateNodeData={handleUpdateNodeData}
        onRunWorkflow={executeWorkflow}
        onChatSend={handleChatSend}
        isRunning={isRunning}
        nodes={nodes}
        edges={edges}
      />

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Toasts */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}

// ─── Wrapper with ReactFlowProvider ─────────────────────────
export default function WorkspaceEditor(props: WorkspaceEditorProps) {
  return (
    <ReactFlowProvider>
      <WorkspaceEditorInner {...props} />
    </ReactFlowProvider>
  );
}
