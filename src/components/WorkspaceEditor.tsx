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
import { NODE_REGISTRY, type NodeDefinition } from "../nodes/types";
import { executeNode } from "../engine";

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

  // Custom 100% opaque drag-and-drop state & events
  const [activeDragNode, setActiveDragNode] = useState<{
    type: string;
    clientX: number;
    clientY: number;
  } | null>(null);

  const handleDragStartNode = useCallback((type: string) => {
    setActiveDragNode({ type, clientX: 0, clientY: 0 });
  }, []);

  const handleDragEndNode = useCallback(() => {
    setActiveDragNode(null);
  }, []);

  // Window-level mouse tracking for the custom opaque drag ghost card
  useEffect(() => {
    if (!activeDragNode) return;

    const handleWindowDragOver = (e: DragEvent) => {
      setActiveDragNode((prev) =>
        prev ? { ...prev, clientX: e.clientX, clientY: e.clientY } : null
      );
    };

    window.addEventListener("dragover", handleWindowDragOver);
    return () => {
      window.removeEventListener("dragover", handleWindowDragOver);
    };
  }, [activeDragNode]);

  const reactFlowInstance = useReactFlow();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoadRef = useRef(true);
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
        type: n.type === "output" ? "outputNode" : n.type,
        position: n.position,
        data: n.data,
      }));

      const loadedEdges: Edge[] = data.edges.map((e) => {
        const isStorage = e.source_handle === "storage";
        // Backward compatibility: map empty targetHandle to "left" for JSON Storage nodes
        const targetNode = data.nodes.find((n) => n.id === e.target);
        const targetHandle = (targetNode && targetNode.type === "jsonStorage" && !e.target_handle)
          ? "left"
          : e.target_handle || undefined;

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.source_handle || undefined,
          targetHandle,
          animated: true,
          style: {
            stroke: isStorage ? "#38bdf8" : "#d4e600",
            strokeWidth: 2,
          },
        };
      });

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

  // ─── Delete space ──────────────────────────────────────────
  const handleDeleteSpace = useCallback(
    async (spaceId: string) => {
      if (spaces.length <= 1) {
        showToast("Cannot delete the only remaining space", "error");
        return;
      }

      try {
        await invoke("delete_space", { workspacePath, spaceId });

        const updatedSpaces = spaces.filter((s) => s.id !== spaceId);
        setSpaces(updatedSpaces);

        // If we deleted the active space, switch to the first remaining one
        if (activeSpaceId === spaceId) {
          const nextSpace = updatedSpaces[0];
          if (nextSpace) {
            isInitialLoadRef.current = true;
            setActiveSpaceId(nextSpace.id);
            setSelectedNode(null);
            await loadSpaceData(nextSpace.id);

            // Update active_space in config
            try {
              const config = await invoke<WorkspaceConfig>("load_workspace_config", {
                workspacePath,
              });
              config.active_space = nextSpace.id;
              await invoke("save_workspace_config", { workspacePath, config });
            } catch (_err) {}

            setTimeout(() => {
              isInitialLoadRef.current = false;
            }, 500);
          }
        }

        showToast("Space deleted", "info");
      } catch (err) {
        showToast(`Failed to delete space: ${err}`, "error");
      }
    },
    [spaces, activeSpaceId, workspacePath, showToast, loadSpaceData]
  );

  const onSpaceContextMenu = useCallback(
    (spaceId: string, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const spaceLabel = spaces.find((s) => s.id === spaceId)?.label || "Space";

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: `Delete Space ${spaceLabel}`,
            icon: "🗑️",
            danger: true,
            onClick: () => {
              handleDeleteSpace(spaceId);
            },
          },
        ],
      });
    },
    [spaces, handleDeleteSpace]
  );

  // ─── Connection handling ───────────────────────────────────
  const onConnect: OnConnect = useCallback(
    (params) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            animated: true,
            style: {
              stroke: params.sourceHandle === "storage" ? "#38bdf8" : "#d4e600",
              strokeWidth: 2,
            },
          },
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

  // ─── Clipboard Operations ─────────────────────────────────

  const deleteSelected = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected);
    const selectedEdges = edges.filter((e) => e.selected);

    if (selectedNodes.length === 0 && selectedEdges.length === 0) return;

    // Prune backend history for deleted JSONStorage nodes
    selectedNodes.forEach((node) => {
      if (node.type === "jsonStorage") {
        invoke("delete_storage_history", {
          workspacePath,
          spaceId: activeSpaceId,
          databaseNodeId: node.id,
        }).catch((err) => {
          console.error("Failed to delete JSON storage history:", err);
        });
      }
    });

    const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));
    const selectedEdgeIds = new Set(selectedEdges.map((e) => e.id));

    setNodes((nds) => nds.filter((n) => !selectedNodeIds.has(n.id)));
    setEdges((eds) =>
      eds.filter(
        (e) =>
          !selectedEdgeIds.has(e.id) &&
          !selectedNodeIds.has(e.source) &&
          !selectedNodeIds.has(e.target)
      )
    );

    if (selectedNode && selectedNodeIds.has(selectedNode.id)) {
      setSelectedNode(null);
    }

    const nodeCount = selectedNodes.length;
    const edgeCount = selectedEdges.length;
    let msg = "";
    if (nodeCount > 0 && edgeCount > 0) {
      msg = `Deleted ${nodeCount} node(s) and ${edgeCount} edge(s)`;
    } else if (nodeCount > 0) {
      msg = `Deleted ${nodeCount} node(s)`;
    } else if (edgeCount > 0) {
      msg = `Deleted ${edgeCount} edge(s)`;
    }
    if (msg) showToast(msg, "info");
  }, [nodes, edges, selectedNode, workspacePath, activeSpaceId, setNodes, setEdges, showToast]);

  const copySelection = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected);
    if (selectedNodes.length === 0) return;

    const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));
    const connectedEdges = edges.filter(
      (e) => selectedNodeIds.has(e.source) && selectedNodeIds.has(e.target)
    );

    const clipboardData = {
      nodes: selectedNodes,
      edges: connectedEdges,
    };

    localStorage.setItem("hive-clipboard", JSON.stringify(clipboardData));
    showToast(`Copied ${selectedNodes.length} node(s)`, "info");
  }, [nodes, edges, showToast]);

  const cutSelection = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected);
    if (selectedNodes.length === 0) return;

    copySelection();
    deleteSelected();
  }, [nodes, copySelection, deleteSelected]);

  const pasteSelection = useCallback((clientX?: number, clientY?: number) => {
    const raw = localStorage.getItem("hive-clipboard");
    if (!raw) return;

    try {
      const clipboardData = JSON.parse(raw);
      if (!clipboardData || !Array.isArray(clipboardData.nodes)) return;

      const clipboardNodes = clipboardData.nodes as Node[];
      const clipboardEdges = (clipboardData.edges || []) as Edge[];

      if (clipboardNodes.length === 0) return;

      // Deselect all existing nodes and edges in state
      setNodes((nds) => nds.map((n) => ({ ...n, selected: false })));
      setEdges((eds) => eds.map((e) => ({ ...e, selected: false })));

      const idMap = new Map<string, string>();
      
      let offsetX = 40;
      let offsetY = 40;

      if (clientX !== undefined && clientY !== undefined && reactFlowInstance) {
        let minX = Infinity;
        let minY = Infinity;
        clipboardNodes.forEach((node) => {
          const px = node.position?.x || 0;
          const py = node.position?.y || 0;
          if (px < minX) minX = px;
          if (py < minY) minY = py;
        });

        const flowCoords = reactFlowInstance.screenToFlowPosition({
          x: clientX,
          y: clientY,
        });

        offsetX = flowCoords.x - minX;
        offsetY = flowCoords.y - minY;
      }

      const newNodes = clipboardNodes.map((node) => {
        const nodeType = node.type === "output" ? "outputNode" : (node.type || "unknown");
        const newId = `${nodeType}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        idMap.set(node.id, newId);

        let newPos = {
          x: (node.position?.x || 0) + 40,
          y: (node.position?.y || 0) + 40,
        };

        if (clientX !== undefined && clientY !== undefined) {
          newPos = {
            x: (node.position?.x || 0) + offsetX,
            y: (node.position?.y || 0) + offsetY,
          };
        }

        return {
          ...node,
          id: newId,
          type: nodeType,
          position: newPos,
          selected: true,
        };
      });

      const newEdges = clipboardEdges
        .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
        .map((edge) => {
          const newId = `edge_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
          return {
            ...edge,
            id: newId,
            source: idMap.get(edge.source)!,
            target: idMap.get(edge.target)!,
            selected: true,
          };
        });

      setNodes((nds) => nds.concat(newNodes));
      setEdges((eds) => eds.concat(newEdges));
      showToast(`Pasted ${newNodes.length} node(s)`, "info");
    } catch (err) {
      console.error("Failed to parse clipboard data:", err);
    }
  }, [setNodes, setEdges, reactFlowInstance, showToast]);

  // ─── Keyboard shortcuts listener ──────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (isCmdOrCtrl && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copySelection();
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === "x") {
        e.preventDefault();
        cutSelection();
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === "v") {
        e.preventDefault();
        pasteSelection();
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
        setEdges((eds) => eds.map((e) => ({ ...e, selected: true })));
        showToast("Selected all elements", "info");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [copySelection, cutSelection, pasteSelection, deleteSelected, setNodes, setEdges, showToast]);

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
            onClick: () => copySelection(),
          },
          {
            label: count > 1 ? `Cut Selection (${count})` : "Cut Node",
            icon: "✂️",
            onClick: () => cutSelection(),
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
                  invoke("delete_storage_history", {
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

      const hasClipboard = !!localStorage.getItem("hive-clipboard");
      const items: ContextMenuItem[] = [];

      if (count > 0) {
        items.push({
          label: count > 1 ? `Copy Selection (${count})` : "Copy Node",
          icon: "📋",
          onClick: () => copySelection(),
        });
        items.push({
          label: count > 1 ? `Cut Selection (${count})` : "Cut Node",
          icon: "✂️",
          onClick: () => cutSelection(),
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
      // If the event was already intercepted by nodes/edges/pane, ignore
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
              onClick: () => copySelection(),
            },
            {
              label: `Cut Selection (${count})`,
              icon: "✂️",
              onClick: () => cutSelection(),
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
              onClick: () => copySelection(),
            },
            {
              label: "Cut Node",
              icon: "✂️",
              onClick: () => cutSelection(),
            },
            {
              label: "Delete Node",
              icon: "🗑️",
              danger: true,
              onClick: () => {
                if (singleNode.type === "jsonStorage") {
                  invoke("delete_storage_history", {
                    workspacePath,
                    spaceId: activeSpaceId,
                    databaseNodeId: singleNode.id,
                  }).catch((err) => {
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

  // ─── Drag and drop node creation ───────────────────────────
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    if (activeDragNode) {
      setActiveDragNode((prev) =>
        prev ? { ...prev, clientX: event.clientX, clientY: event.clientY } : null
      );
    }
  }, [activeDragNode]);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      if (!event.dataTransfer) {
        setActiveDragNode(null);
        return;
      }
      const type = event.dataTransfer.getData("application/reactflow");

      // Check if dropped element is valid
      if (!type) {
        setActiveDragNode(null);
        return;
      }

      // Dynamically measure the actual screen size of the floating drag ghost card
      const ghostEl = document.getElementById("drag-ghost-card");
      let offsetX = 45; // Safe default fallback
      let offsetY = 40; // Safe default fallback
      if (ghostEl) {
        const rect = ghostEl.getBoundingClientRect();
        offsetX = rect.width / 2;
        offsetY = rect.height / 2;
      }

      setActiveDragNode(null);

      // Project client coordinates to flow coordinates, centered under cursor
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - offsetX,
        y: event.clientY - offsetY,
      });

      // Find corresponding node definition from NODE_REGISTRY
      const definition = NODE_REGISTRY.find((d) => d.type === type);
      if (!definition) return;

      const id = `${type}_${Date.now()}`;
      const newNode: Node = {
        id,
        type,
        position,
        data: { ...definition.defaultData },
      };

      setNodes((nds) => [...nds, newNode]);
      showToast(`Added ${definition.label} node`, "info");
    },
    [reactFlowInstance, setNodes, showToast]
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
  const executeWorkflow = useCallback(async (triggerNodeId?: string) => {
    let triggerNodes = nodes.filter((n) => n.type === "trigger");
    if (triggerNodeId && typeof triggerNodeId === "string") {
      triggerNodes = triggerNodes.filter((n) => n.id === triggerNodeId);
    }
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
        onSpaceContextMenu={onSpaceContextMenu}
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
          fitView
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
          defaultEdgeOptions={{
            animated: true,
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
        isRunning={isRunning}
        nodes={nodes}
        edges={edges}
        onDragStartNode={handleDragStartNode}
        onDragEndNode={handleDragEndNode}
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
