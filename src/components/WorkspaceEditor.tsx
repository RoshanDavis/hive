import { useCallback, useState, useMemo, useEffect, useSyncExternalStore } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type OnSelectionChangeFunc,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import SpacesSidebar from "@/components/SpacesSidebar";
import InspectorPanel from "@/components/InspectorPanel";
import { SettingsModal } from "@/components/settings";
import ContextMenu from "@/components/ContextMenu";
import { ToastContainer } from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import "@/nodes/plugins"; // Side-effect import: registers all node plugins
import { pluginRegistry } from "@/engine/pluginRegistry";
import GenericNodeShell from "@/nodes/GenericNodeShell";
import CustomConnectionEdge from "@/components/CustomConnectionEdge";
import { getStatusColor } from "@/theme/colors";
import { useTheme } from "@/contexts/ThemeContext";
import { type NodeDefinition } from "@/nodes/types";
import { useWorkspaceClipboard } from "@/hooks/useWorkspaceClipboard";

import { type ContextMenuState } from "@/types/workspace";
import { useWorkspaceSpaces } from "@/hooks/useWorkspaceSpaces";
import { NodeDefaultsProvider, useNodeDefaults } from "@/contexts/NodeDefaultsContext";
import { useRegistryVersion } from "@/hooks/useRegistryVersion";
import { isCustomType } from "@/types/customNodes";
import { makeUnknownCustomPlugin } from "@/components/customNodes/unknownCustomPlugin";
import { useWorkspaceDragDrop } from "@/hooks/useWorkspaceDragDrop";
import { useWorkspaceRunner } from "@/hooks/useWorkspaceRunner";
import { useBackgroundRunners } from "@/contexts/BackgroundRunnersContext";
import { useRightClickDragGuard } from "@/hooks/useRightClickDragGuard";
import { useWorkspaceContextMenus } from "@/hooks/useWorkspaceContextMenus";
import { useEdgeOperations } from "@/hooks/useEdgeOperations";

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
  workspacePath,
  backgroundExecution,
  onBack,
}: WorkspaceEditorProps) {
  const { toasts, showToast } = useToast(3500);
  // Subscribe to theme so the canvas chrome (dots, minimap, edge styles)
  // re-renders on theme switch. getStatusColor + the edge color helpers
  // inside the hooks below read from the active theme on every call.
  const theme = useTheme();

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

  const { handleMouseDown, wasRightClickDrag } = useRightClickDragGuard();

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
    otherSpaceWorkflows,
    executeWorkflow,
    handleChatSend,
    retryWorkflow,
    retryWorkflowInSpace,
    cancelWorkflow,
    cancelWorkflowInSpace,
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

  // ─── Edge create / update / delete ────────────────────────
  const { onConnect, handleUpdateEdgeData, handleDeleteEdge } = useEdgeOperations({
    nodes,
    setEdges,
    setSelectedEdge,
    showToast,
  });

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

  // ─── Right-click context menus (node / edge / pane) ──────────
  const {
    onNodeContextMenu,
    onEdgeContextMenu,
    onPaneContextMenu,
    handleWrapperContextMenu,
    deleteSingleNode,
  } = useWorkspaceContextMenus({
    nodes,
    selectedNode,
    setSelectedNode,
    setNodes,
    setEdges,
    setContextMenu,
    copySelection,
    cutSelection,
    deleteSelected,
    pasteSelection,
    workspacePath,
    activeSpaceId,
    showToast,
    wasRightClickDrag,
  });

  // Inspector "Delete node" callback. Adapts `deleteSingleNode(node)` to take a
  // node id, looking the node up at click time so we always operate on the
  // freshest snapshot (the React Flow selection may lag a frame behind).
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) deleteSingleNode(node);
    },
    [nodes, deleteSingleNode]
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
            style: { stroke: theme.edges.default, strokeWidth: 2 },
          }}
          panOnDrag={[1, 2]}
          selectionOnDrag={true}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.2}
            color={theme.canvas.backgroundDots}
          />
          <Controls position="bottom-left" showInteractive={false} />
          {/* The "Clear statuses" affordance moved into the Workflows section
              of the workspace inspector (right panel) so all workflow-level
              controls live in one place. */}
          <MiniMap
            position="bottom-right"
            nodeColor={(n) => getStatusColor(n.data?.status)}
            maskColor={theme.canvas.minimapMask}
            style={{
              background: theme.canvas.minimapBg,
              border: `1px solid ${theme.canvas.minimapBorder}`,
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
        workspacePath={workspacePath}
        selectedNode={currentSelectedNode}
        onAddNode={handleAddNode}
        onUpdateNodeData={handleUpdateNodeData}
        onRunWorkflow={executeWorkflow}
        onChatSend={handleChatSend}
        onRetryWorkflow={retryWorkflow}
        onCancelWorkflow={cancelWorkflow}
        onRetryWorkflowInSpace={retryWorkflowInSpace}
        onCancelWorkflowInSpace={cancelWorkflowInSpace}
        onClearAllStatuses={clearAllStatuses}
        runningStartNodeIds={runningStartNodeIds}
        activeSpaceId={activeSpaceId}
        otherSpaceWorkflows={otherSpaceWorkflows}
        nodes={nodes}
        edges={edges}
        onDragStartNode={handleDragStartNode}
        onDragEndNode={handleDragEndNode}
        selectedEdge={selectedEdge}
        onUpdateEdgeData={handleUpdateEdgeData}
        onDeleteEdge={handleDeleteEdge}
        onDeleteNode={handleDeleteNode}
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
            className="fixed pointer-events-none z-99999 bg-card border border-accent-dim rounded-lg px-3 py-2.5 shadow-drag-ghost flex flex-col items-center justify-center gap-1.5 min-w-22.5 max-w-37.5 transition-transform duration-75 select-none"
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
