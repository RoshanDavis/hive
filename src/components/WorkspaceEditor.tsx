import { useCallback, useState, useMemo, useRef } from "react";
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
  ReactFlowProvider,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/services/api";

import SpacesSidebar from "@/components/SpacesSidebar";
import InspectorPanel from "@/components/InspectorPanel";
import WorkspaceSettingsModal from "@/components/WorkspaceSettingsModal";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import { ToastContainer } from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import { storage } from "@/services/storage";
import TriggerNodeComponent from "@/nodes/TriggerNode";
import NotifyNodeComponent from "@/nodes/NotifyNode";
import OllamaNodeComponent from "@/nodes/OllamaNode";
import ChatNodeComponent from "@/nodes/ChatNode";
import OutputNodeComponent from "@/nodes/OutputNode";
import JSONStorageNodeComponent from "@/nodes/JSONStorageNode";
import CustomConnectionEdge from "@/components/CustomConnectionEdge";
import { type NodeDefinition } from "@/nodes/types";
import { NODE_REGISTRY } from "@/nodes/registry";
import { useWorkspaceClipboard } from "@/hooks/useWorkspaceClipboard";
import { getConnectionBehavior } from "@/engine/connectivity";

// Import consolidated types & custom hooks
import {
  type ContextMenuState,
} from "@/types/workspace";
import { useWorkspaceSpaces } from "@/hooks/useWorkspaceSpaces";
import { useWorkspaceDragDrop } from "@/hooks/useWorkspaceDragDrop";
import { useWorkspaceRunner } from "@/hooks/useWorkspaceRunner";

// ─── Props ───────────────────────────────────────────────────
interface WorkspaceEditorProps {
  workspaceName: string;
  workspacePath: string;
  onBack: () => void;
}

const nodeTypes = {
  trigger: TriggerNodeComponent,
  notify: NotifyNodeComponent,
  ollama: OllamaNodeComponent,
  chat: ChatNodeComponent,
  output: OutputNodeComponent,
  outputNode: OutputNodeComponent,
  jsonStorage: JSONStorageNodeComponent,
};

const edgeTypes = {
  custom: CustomConnectionEdge,
};

// ─── Inner component (needs ReactFlowProvider) ──────────────
function WorkspaceEditorInner({
  workspaceName: _workspaceName,
  workspacePath,
  onBack,
}: WorkspaceEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const { toasts, showToast } = useToast(3500);

  const rightClickStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) {
      rightClickStartRef.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const wasRightClickDrag = useCallback((event: MouseEvent | React.MouseEvent) => {
    if (!rightClickStartRef.current) return false;
    const dx = event.clientX - rightClickStartRef.current.x;
    const dy = event.clientY - rightClickStartRef.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    rightClickStartRef.current = null; // reset
    return dist > 5;
  }, []);

  // ─── Spaces custom hook ────────────────────────────────────
  const {
    spaces,
    activeSpaceId,
    editingSpaceId,
    isLoading,
    setEditingSpaceId,
    saveCurrentSpace,
    handleSwitchSpace,
    handleAddSpace,
    handleRenameSpace,
    onSpaceContextMenu,
  } = useWorkspaceSpaces({
    workspacePath,
    nodes,
    edges,
    setNodes,
    setEdges,
    setSelectedNode,
    showToast,
    setContextMenu,
  });

  // ─── Drag & Drop custom hook ───────────────────────────────
  const {
    activeDragNode,
    handleDragStartNode,
    handleDragEndNode,
    handleDragOver,
    handleDrop,
  } = useWorkspaceDragDrop({
    setNodes,
    showToast,
  });

  // ─── Clipboard & Deletion Operations (Modular Custom Hook) ──
  const { copySelection, cutSelection, pasteSelection, deleteSelected } = useWorkspaceClipboard({
    nodes,
    edges,
    setNodes,
    setEdges,
    selectedNode,
    setSelectedNode,
    workspacePath,
    activeSpaceId,
    showToast,
  });

  // ─── Node data updates ─────────────────────────────────────
  const handleUpdateNodeData = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...data } } : n))
      );
    },
    [setNodes]
  );

  // ─── Runner custom hook ────────────────────────────────────
  const {
    isRunning,
    executeWorkflow,
    handleChatSend,
    retryWorkflow,
  } = useWorkspaceRunner({
    nodes,
    edges,
    setNodes,
    handleUpdateNodeData,
    showToast,
  });

  // ─── Connection handling ───────────────────────────────────
  const onConnect: OnConnect = useCallback(
    (params) =>
      setEdges((eds) => {
        const sourceNode = nodes.find((n) => n.id === params.source);
        const targetNode = nodes.find((n) => n.id === params.target);
        const { defaultFlow } = getConnectionBehavior(
          sourceNode?.type,
          targetNode?.type,
          params.sourceHandle,
          params.targetHandle
        );

        return addEdge(
          {
            ...params,
            type: "custom",
            data: {
              edgeType: defaultFlow,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: "#d4e600",
              width: 16,
              height: 16,
            },
            markerStart: defaultFlow === "bi-directional" ? {
              type: MarkerType.ArrowClosed,
              color: "#d4e600",
              width: 16,
              height: 16,
            } : undefined,
            style: {
              stroke: "#d4e600",
              strokeWidth: 2,
            },
          },
          eds
        );
      }),
    [setEdges, nodes]
  );

  // ─── Selection tracking ───────────────────────────────────
  const onSelectionChange: OnSelectionChangeFunc = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }) => {
      if (selectedNodes.length === 1) {
        setSelectedNode(selectedNodes[0]);
        setSelectedEdge(null);
      } else if (selectedEdges.length === 1) {
        setSelectedEdge(selectedEdges[0]);
        setSelectedNode(null);
      } else {
        setSelectedNode(null);
        setSelectedEdge(null);
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
    setSelectedEdge(null);
    setContextMenu(null);
  }, []);

  // ─── Context menu: right-click node ────────────────────────
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      event.stopPropagation();

      // If the right-click was part of a drag-pan operation, skip the context menu
      if (wasRightClickDrag(event)) return;

      const selectedNodes = nodes.filter((n) => n.selected);
      const isClickedSelected = selectedNodes.some((n) => n.id === node.id);
      const count = isClickedSelected ? selectedNodes.length : 1;

      if (!isClickedSelected) {
        // Deselect everything else and select only this node
        setNodes((nds) =>
          nds.map((n) => ({
            ...n,
            selected: n.id === node.id,
          }))
        );
      }

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: count > 1 ? `Copy Selection (${count})` : "Copy Node",
            icon: "📋",
            onClick: () => copySelection(false),
          },
          {
            label: count > 1 ? `Copy Selection with Data (${count})` : "Copy Node with Data",
            icon: "🗂️",
            onClick: () => copySelection(true),
          },
          {
            label: count > 1 ? `Cut Selection (${count})` : "Cut Node",
            icon: "✂️",
            onClick: () => cutSelection(false),
          },
          {
            label: count > 1 ? `Delete Selection (${count})` : "Delete Node",
            icon: "🗑️",
            danger: true,
            onClick: () => {
              if (count > 1) {
                deleteSelected();
              } else {
                if (node.type === "jsonStorage") {
                  api.deleteStorageHistory(workspacePath, activeSpaceId, node.id).catch((err) => {
                    console.error("Failed to delete JSON storage history:", err);
                  });
                }
                setNodes((nds) => nds.filter((n) => n.id !== node.id));
                setEdges((eds) =>
                  eds.filter((e) => e.source !== node.id && e.target !== node.id)
                );
                if (selectedNode?.id === node.id) setSelectedNode(null);
                showToast("Node deleted", "info");
              }
            },
          },
        ],
      });
    },
    [nodes, setNodes, setEdges, selectedNode, showToast, workspacePath, activeSpaceId, copySelection, cutSelection, deleteSelected, wasRightClickDrag]
  );

  // ─── Context menu: right-click edge ────────────────────────
  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      event.stopPropagation();

      if (wasRightClickDrag(event)) return;

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
    [setEdges, showToast, wasRightClickDrag]
  );

  // Canvas background context menu (Paste / Select All / Selection Actions)
  const onPaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (wasRightClickDrag(event)) return;

      const selectedNodes = nodes.filter((n) => n.selected);
      const count = selectedNodes.length;

      const hasClipboard = storage.hasClipboard();
      const items: ContextMenuItem[] = [];

      if (count > 0) {
        items.push({
          label: count > 1 ? `Copy Selection (${count})` : "Copy Node",
          icon: "📋",
          onClick: () => copySelection(false),
        });
        items.push({
          label: count > 1 ? `Copy Selection with Data (${count})` : "Copy Node with Data",
          icon: "🗂️",
          onClick: () => copySelection(true),
        });
        items.push({
          label: count > 1 ? `Cut Selection (${count})` : "Cut Node",
          icon: "✂️",
          onClick: () => cutSelection(false),
        });
        items.push({
          label: count > 1 ? `Delete Selection (${count})` : "Delete Node",
          icon: "🗑️",
          danger: true,
          onClick: () => deleteSelected(),
        });
      }

      if (hasClipboard) {
        items.push({
          label: "Paste Node(s)",
          icon: "📋",
          onClick: () => pasteSelection(event.clientX, event.clientY),
        });
      }

      items.push({
        label: "Select All Nodes",
        icon: "✨",
        onClick: () => {
          setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
          setEdges((eds) => eds.map((e) => ({ ...e, selected: true })));
          showToast("Selected all elements", "info");
        },
      });

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items,
      });
    },
    [nodes, copySelection, cutSelection, deleteSelected, pasteSelection, setNodes, setEdges, showToast, wasRightClickDrag]
  );

  // Global context menu catcher for overlays (e.g., selection overlay)
  const handleWrapperContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (event.isPropagationStopped()) return;

      const selectedNodes = nodes.filter((n) => n.selected);
      const count = selectedNodes.length;

      if (count >= 1) {
        event.preventDefault();
        event.stopPropagation();

        if (wasRightClickDrag(event)) return;

        const singleNode = selectedNodes[0];

        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          items: count > 1 ? [
            {
              label: `Copy Selection (${count})`,
              icon: "📋",
              onClick: () => copySelection(false),
            },
            {
              label: `Copy Selection with Data (${count})`,
              icon: "🗂️",
              onClick: () => copySelection(true),
            },
            {
              label: `Cut Selection (${count})`,
              icon: "✂️",
              onClick: () => cutSelection(false),
            },
            {
              label: `Delete Selection (${count})`,
              icon: "🗑️",
              danger: true,
              onClick: () => deleteSelected(),
            },
            {
              label: "Select All Nodes",
              icon: "✨",
              onClick: () => {
                setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
                setEdges((eds) => eds.map((e) => ({ ...e, selected: true })));
                showToast("Selected all elements", "info");
              },
            },
          ] : [
            {
              label: "Copy Node",
              icon: "📋",
              onClick: () => copySelection(false),
            },
            {
              label: "Copy Node with Data",
              icon: "🗂️",
              onClick: () => copySelection(true),
            },
            {
              label: "Cut Node",
              icon: "✂️",
              onClick: () => cutSelection(false),
            },
            {
              label: "Delete Node",
              icon: "🗑️",
              danger: true,
              onClick: () => {
                if (singleNode.type === "jsonStorage") {
                  api.deleteStorageHistory(workspacePath, activeSpaceId, singleNode.id).catch((err) => {
                    console.error("Failed to delete JSON storage history:", err);
                  });
                }
                setNodes((nds) => nds.filter((n) => n.id !== singleNode.id));
                setEdges((eds) =>
                  eds.filter((e) => e.source !== singleNode.id && e.target !== singleNode.id)
                );
                if (selectedNode?.id === singleNode.id) setSelectedNode(null);
                showToast("Node deleted", "info");
              },
            },
          ],
        });
      }
    },
    [nodes, copySelection, cutSelection, deleteSelected, setNodes, setEdges, showToast, wasRightClickDrag, workspacePath, activeSpaceId, selectedNode]
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

  // ─── Update edge type ──────────────────────────────────────
  const handleUpdateEdgeData = useCallback(
    (edgeId: string, edgeType: string) => {
      setEdges((eds) =>
        eds.map((e) => {
          if (e.id === edgeId) {
            return {
              ...e,
              data: {
                ...e.data,
                edgeType,
              },
              markerStart: edgeType === "bi-directional" ? {
                type: MarkerType.ArrowClosed,
                color: "#d4e600",
                width: 16,
                height: 16,
              } : undefined,
            };
          }
          return e;
        })
      );
      setSelectedEdge((prev) =>
        prev && prev.id === edgeId
          ? {
              ...prev,
              data: {
                ...prev.data,
                edgeType,
              },
            }
          : prev
      );
    },
    [setEdges]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      setSelectedEdge(null);
      showToast("Connection deleted", "info");
    },
    [setEdges, showToast]
  );

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
        onSpaceContextMenu={onSpaceContextMenu}
        editingSpaceId={editingSpaceId}
        setEditingSpaceId={setEditingSpaceId}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Center — React Flow Canvas */}
      <div
        className="flex-1 relative"
        onMouseDown={handleMouseDown}
        onContextMenu={handleWrapperContextMenu}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
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
          edgeTypes={edgeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
          defaultEdgeOptions={{
            type: "custom",
            style: { stroke: "#d4e600", strokeWidth: 2 },
          }}
          panOnDrag={[1, 2]}
          selectionOnDrag={true}
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
              if (n.type === "output" || n.type === "outputNode") return "#fb923c";
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
        onRetryWorkflow={retryWorkflow}
        isRunning={isRunning}
        nodes={nodes}
        edges={edges}
        onDragStartNode={handleDragStartNode}
        onDragEndNode={handleDragEndNode}
        selectedEdge={selectedEdge}
        onUpdateEdgeData={handleUpdateEdgeData}
        onDeleteEdge={handleDeleteEdge}
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

      {/* Settings Modal */}
      <WorkspaceSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        showToast={showToast}
      />

      {/* Custom 100% Opaque Floating Ghost Card (Bypasses browser transparency limitations) */}
      {activeDragNode && activeDragNode.clientX > 0 && activeDragNode.clientY > 0 && (() => {
        const def = NODE_REGISTRY.find((d) => d.type === activeDragNode.type);
        if (!def) return null;
        return (
          <div
            id="drag-ghost-card"
            className="fixed pointer-events-none z-[99999] bg-card border border-accent-dim rounded-lg px-3 py-2.5 shadow-[0_12px_36px_rgba(0,0,0,0.9)] flex flex-col items-center justify-center gap-1.5 min-w-[90px] max-w-[150px] transition-transform duration-75 select-none"
            style={{
              left: activeDragNode.clientX,
              top: activeDragNode.clientY,
              transform: "translate(-50%, -50%) scale(1.05)",
            }}
          >
            <span className="text-2xl select-none">{def.icon}</span>
            <span className="font-semibold text-text-main text-xs select-none w-full text-center whitespace-nowrap overflow-hidden text-ellipsis">{def.label}</span>
          </div>
        );
      })()}
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
