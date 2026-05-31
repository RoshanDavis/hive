import { useCallback, useState, useMemo, useRef, useEffect, useSyncExternalStore } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  type OnConnect,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type OnSelectionChangeFunc,
  BackgroundVariant,
  ReactFlowProvider,
  MarkerType,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/services/api";

import SpacesSidebar from "@/components/SpacesSidebar";
import InspectorPanel from "@/components/InspectorPanel";
import { SettingsModal } from "@/components/settings";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import { ToastContainer } from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import { storage } from "@/services/storage";
import "@/nodes/plugins"; // Side-effect import: registers all node plugins
import { pluginRegistry } from "@/engine/pluginRegistry";
import GenericNodeShell from "@/nodes/GenericNodeShell";
import CustomConnectionEdge from "@/components/CustomConnectionEdge";
import { EDGE, CANVAS, getStatusColor } from "@/theme/colors";
import { type NodeDefinition } from "@/nodes/types";
import { useWorkspaceClipboard } from "@/hooks/useWorkspaceClipboard";
import { getConnectionBehavior } from "@/engine/connectivity";

// Import consolidated types & custom hooks
import {
  type ContextMenuState,
} from "@/types/workspace";
import { useWorkspaceSpaces } from "@/hooks/useWorkspaceSpaces";
import { NodeDefaultsProvider, useNodeDefaults } from "@/contexts/NodeDefaultsContext";
import { useRegistryVersion } from "@/hooks/useRegistryVersion";
import { isCustomType } from "@/types/customNodes";
import { makeUnknownCustomPlugin } from "@/components/customNodes/unknownCustomPlugin";
import { useWorkspaceDragDrop } from "@/hooks/useWorkspaceDragDrop";
import { useWorkspaceRunner } from "@/hooks/useWorkspaceRunner";
import { useBackgroundRunners } from "@/contexts/BackgroundRunnersContext";

// ─── Props ───────────────────────────────────────────────────
interface WorkspaceEditorProps {
  workspaceName: string;
  workspacePath: string;
  /** Persisted `Workspace.background_execution` flag at open time. Forwarded
   * to `getOrCreateSession` so the new session starts with the correct
   * retention policy instead of defaulting to true and self-correcting. */
  backgroundExecution: boolean;
  onBack: () => void;
}

const edgeTypes = {
  custom: CustomConnectionEdge,
};

// ─── Inner component (needs ReactFlowProvider) ──────────────
function WorkspaceEditorInner({
  workspaceName: _workspaceName,
  workspacePath,
  backgroundExecution,
  onBack,
}: WorkspaceEditorProps) {
  const { toasts, showToast } = useToast(3500);

  // ─── Session attach/detach (lives in BackgroundRunnersContext) ───
  // The session is the canonical source of truth for nodes/edges/viewport/
  // spaces/runs. The editor is a view that attaches on mount and detaches on
  // unmount; the session may outlive us if backgroundExecution is on and a run
  // is in flight.
  const runners = useBackgroundRunners();
  const session = useMemo(
    () => runners.getOrCreateSession(workspacePath, showToast, backgroundExecution),
    // We intentionally omit `showToast` and `backgroundExecution` from deps:
    // they would re-create the session needlessly. `showToast` isn't stable
    // (useToast), and `backgroundExecution` only matters at session creation —
    // subsequent toggle changes flow through the provider's setter, not here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runners, workspacePath]
  );

  // Re-bind the latest toast sink on every render so the session always has a
  // fresh handle (showToast captures the editor's setToasts closure).
  useEffect(() => {
    session.setShowToast(showToast);
  }, [session, showToast]);

  // Detach on unmount. The session decides retain-vs-dispose internally.
  useEffect(() => {
    return () => {
      runners.detachSession(workspacePath);
    };
  }, [runners, workspacePath]);

  // Subscribe to the canonical state via useSyncExternalStore. Any session
  // mutation (load, run-loop status write, manual edit, paste, etc.) re-renders
  // the editor with the new snapshot.
  const snapshot = useSyncExternalStore(
    useCallback((cb) => session.subscribe(cb), [session]),
    useCallback(() => session.getSnapshot(), [session]),
    useCallback(() => session.getSnapshot(), [session])
  );

  const nodes = snapshot.nodes;
  const edges = snapshot.edges;
  const spaces = snapshot.spaces;
  const activeSpaceId = snapshot.activeSpaceId;
  const editingSpaceId = snapshot.editingSpaceId;
  const isLoading = snapshot.isLoading;

  // ─── Editor-local UI state (re-derived on remount; safe to lose) ──
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Stable callback adapters bound to the session. ReactFlow expects React-
  // style setStateAction dispatchers; the session accepts the same shape.
  const setNodes = useCallback(
    (updater: Node[] | ((prev: Node[]) => Node[])) => session.setNodes(updater),
    [session]
  );
  const setEdges = useCallback(
    (updater: Edge[] | ((prev: Edge[]) => Edge[])) => session.setEdges(updater),
    [session]
  );
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => session.applyNodeChanges(changes),
    [session]
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => session.applyEdgeChanges(changes),
    [session]
  );

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

  // ─── Spaces view bound to session ─────────────────────────
  const {
    setEditingSpaceId,
    handleSwitchSpace,
    handleAddSpace,
    handleRenameSpace,
    onSpaceContextMenu,
  } = useWorkspaceSpaces({
    session,
    workspacePath,
    spaces,
    activeSpaceId,
    editingSpaceId,
    isLoading,
    setSelectedNode,
    showToast,
    setContextMenu,
  });

  // ─── Node defaults context — merged global+workspace overrides ──
  const { getMergedOverrides } = useNodeDefaults();

  // Rebuild the React Flow node-types map whenever the registry changes so
  // runtime-registered custom nodes (custom:<id>) get a component mapping.
  const registryVersion = useRegistryVersion();
  const nodeTypes = useMemo(
    () => pluginRegistry.getNodeTypesMap(GenericNodeShell),
    [registryVersion]
  );

  // Graceful-missing: a loaded space may reference a custom:<id> whose definition
  // is gone. Register a visible placeholder so the node renders instead of being
  // silently downgraded by React Flow. A real definition (if it loads) overwrites it.
  useEffect(() => {
    for (const n of nodes) {
      if (isCustomType(n.type) && !pluginRegistry.get(n.type!)) {
        pluginRegistry.registerCustom(makeUnknownCustomPlugin(n.type!), "workspace");
      }
    }
  }, [nodes, registryVersion]);

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
    getMergedOverrides,
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
      session.updateNodeData(nodeId, data);
    },
    [session]
  );

  // ─── Runner view (bound to session) ─────────────────────────
  const {
    runningStartNodeIds,
    executeWorkflow,
    handleChatSend,
    retryWorkflow,
    cancelWorkflow,
    clearAllStatuses,
  } = useWorkspaceRunner(session);

  // ─── ReactFlow viewport sync ──────────────────────────────
  // Push viewport changes into the session so they persist (and survive
  // editor unmount). The first viewport restoration is done by useWorkspaceSpaces.
  const reactFlowInstance = useReactFlow();
  const onMoveEnd = useCallback(() => {
    const v = reactFlowInstance.getViewport();
    session.setViewport(v);
  }, [reactFlowInstance, session]);

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
              color: EDGE.default,
              width: 16,
              height: 16,
            },
            markerStart: defaultFlow === "bi-directional" ? {
              type: MarkerType.ArrowClosed,
              color: EDGE.default,
              width: 16,
              height: 16,
            } : undefined,
            style: {
              stroke: EDGE.default,
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
                const delPlugin = pluginRegistry.get(node.type || '');
                if (delPlugin?.meta.category === 'storage') {
                  api.deleteStorageHistory(workspacePath, activeSpaceId, node.id).catch((err) => {
                    console.error("Failed to delete storage history:", err);
                  });
                }
                if (node.type === 'chat' || delPlugin?.baseType === 'chat') {
                  api.deleteChatHistory(workspacePath, activeSpaceId, node.id).catch((err) => {
                    console.error("Failed to delete chat history:", err);
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
                const delPlugin = pluginRegistry.get(singleNode.type || '');
                if (delPlugin?.meta.category === 'storage') {
                  api.deleteStorageHistory(workspacePath, activeSpaceId, singleNode.id).catch((err) => {
                    console.error("Failed to delete storage history:", err);
                  });
                }
                if (singleNode.type === 'chat' || delPlugin?.baseType === 'chat') {
                  api.deleteChatHistory(workspacePath, activeSpaceId, singleNode.id).catch((err) => {
                    console.error("Failed to delete chat history:", err);
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
  // Layer overrides on top of plugin.defaultData:
  //   plugin.defaultData ← globalDefaults[type] ← workspaceDefaults[type]
  const handleAddNode = useCallback(
    (definition: NodeDefinition) => {
      const id = `${definition.type}_${Date.now()}`;
      const offset = nodes.length * 40;
      const overrides = getMergedOverrides(definition.type);
      const newNode: Node = {
        id,
        type: definition.type,
        position: { x: 200 + offset, y: 150 + offset },
        data: { ...definition.defaultData, ...overrides },
      };
      setNodes((prev) => [...prev, newNode]);
      showToast(`Added ${definition.label} node`, "info");
    },
    [nodes.length, setNodes, showToast, getMergedOverrides]
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
                color: EDGE.default,
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

  // ─── Back handler ──────────────────────────────────────────
  // Persistence is owned by the session: detach() decides whether to retain
  // (background execution + active runs) or flush + dispose.
  const handleBack = useCallback(() => {
    onBack();
  }, [onBack]);

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
          onMoveEnd={onMoveEnd}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
          defaultEdgeOptions={{
            type: "custom",
            style: { stroke: EDGE.default, strokeWidth: 2 },
          }}
          panOnDrag={[1, 2]}
          selectionOnDrag={true}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.2}
            color={CANVAS.backgroundDots}
          />
          <Controls position="bottom-left" showInteractive={false} />
          {/* The "Clear statuses" affordance moved into the Workflows section
              of the workspace inspector (right panel) so all workflow-level
              controls live in one place. */}
          <MiniMap
            position="bottom-right"
            nodeColor={(n) => getStatusColor(n.data?.status)}
            maskColor={CANVAS.minimapMask}
            style={{
              background: CANVAS.minimapBg,
              border: `1px solid ${CANVAS.minimapBorder}`,
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
        workspaceName={_workspaceName}
        workspacePath={workspacePath}
        selectedNode={currentSelectedNode}
        onAddNode={handleAddNode}
        onUpdateNodeData={handleUpdateNodeData}
        onRunWorkflow={executeWorkflow}
        onChatSend={handleChatSend}
        onRetryWorkflow={retryWorkflow}
        onCancelWorkflow={cancelWorkflow}
        onClearAllStatuses={clearAllStatuses}
        runningStartNodeIds={runningStartNodeIds}
        nodes={nodes}
        edges={edges}
        onDragStartNode={handleDragStartNode}
        onDragEndNode={handleDragEndNode}
        selectedEdge={selectedEdge}
        onUpdateEdgeData={handleUpdateEdgeData}
        onDeleteEdge={handleDeleteEdge}
        showToast={showToast}
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
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        showToast={showToast}
        workspacePath={workspacePath}
      />

      {/* Custom 100% Opaque Floating Ghost Card (Bypasses browser transparency limitations) */}
      {activeDragNode && activeDragNode.clientX > 0 && activeDragNode.clientY > 0 && (() => {
        const plugin = pluginRegistry.get(activeDragNode.type);
        if (!plugin) return null;
        return (
          <div
            id="drag-ghost-card"
            className="fixed pointer-events-none z-99999 bg-card border border-accent-dim rounded-lg px-3 py-2.5 shadow-[0_12px_36px_rgba(0,0,0,0.9)] flex flex-col items-center justify-center gap-1.5 min-w-22.5 max-w-37.5 transition-transform duration-75 select-none"
            style={{
              left: activeDragNode.clientX,
              top: activeDragNode.clientY,
              transform: "translate(-50%, -50%) scale(1.05)",
            }}
          >
            <span className="text-2xl select-none">{plugin.meta.icon}</span>
            <span className="font-semibold text-text-main text-xs select-none w-full text-center whitespace-nowrap overflow-hidden text-ellipsis">{plugin.meta.label}</span>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Wrapper with ReactFlowProvider + NodeDefaultsProvider ──────
export default function WorkspaceEditor(props: WorkspaceEditorProps) {
  return (
    <NodeDefaultsProvider workspacePath={props.workspacePath}>
      <ReactFlowProvider>
        <WorkspaceEditorInner {...props} />
      </ReactFlowProvider>
    </NodeDefaultsProvider>
  );
}
