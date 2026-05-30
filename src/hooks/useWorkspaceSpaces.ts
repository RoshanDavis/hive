import { useCallback, useState, useEffect, useRef } from "react";
import { useReactFlow, MarkerType, type Node, type Edge } from "@xyflow/react";
import { api } from "@/services/api";
import { getConnectionBehavior } from "@/engine/connectivity";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { EDGE } from "@/theme/colors";
import {
  type SpaceEntry,
  type SpaceData,
  type ContextMenuState,
  type ShowToastFunc,
} from "@/types/workspace";

interface UseWorkspaceSpacesParams {
  workspacePath: string;
  nodes: Node[];
  edges: Edge[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  setSelectedNode: React.Dispatch<React.SetStateAction<Node | null>>;
  showToast: ShowToastFunc;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
}

export function useWorkspaceSpaces({
  workspacePath,
  nodes,
  edges,
  setNodes,
  setEdges,
  setSelectedNode,
  showToast,
  setContextMenu,
}: UseWorkspaceSpacesParams) {
  const [spaces, setSpaces] = useState<SpaceEntry[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string>("");
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const reactFlowInstance = useReactFlow();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoadRef = useRef(true);

  // ─── Load workspace config on mount ────────────────────────
  useEffect(() => {
    const loadConfig = async () => {
      try {
        setIsLoading(true);
        const config = await api.loadWorkspaceConfig(workspacePath);
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
      const data = await api.loadSpace(workspacePath, spaceId);

      const loadedNodes: Node[] = data.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
      }));

      const loadedEdges: Edge[] = data.edges.map((e) => {
        // Backward compatibility: map empty targetHandle to "left" for storage nodes
        const targetNode = data.nodes.find((n) => n.id === e.target);
        const targetPlugin = targetNode ? pluginRegistry.get(targetNode.type) : undefined;
        const targetHandle =
          targetPlugin?.meta.category === 'storage' && !e.target_handle
            ? "left"
            : e.target_handle || undefined;

        const sourceNode = data.nodes.find((n) => n.id === e.source);
        const { allowedOption } = getConnectionBehavior(
          sourceNode?.type,
          targetNode?.type,
          e.source_handle || undefined,
          targetHandle
        );

        // Custom edge type serialization
        let edgeType = e.edge_type || "one-way";
        if (edgeType === "bi-directional" && allowedOption === "one-way") {
          edgeType = "one-way";
        }

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.source_handle || undefined,
          targetHandle,
          type: "custom",
          data: {
            edgeType,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: EDGE.default,
            width: 16,
            height: 16,
          },
          markerStart:
            edgeType === "bi-directional"
              ? {
                  type: MarkerType.ArrowClosed,
                  color: EDGE.default,
                  width: 16,
                  height: 16,
                }
              : undefined,
          style: {
            stroke: EDGE.default,
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
        edge_type: (e.data?.edgeType as string) || undefined,
      })),
      viewport,
    };

    try {
      await api.saveSpace(workspacePath, spaceData);
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
        const config = await api.loadWorkspaceConfig(workspacePath);
        config.active_space = newSpaceId;
        await api.saveWorkspaceConfig(workspacePath, config);
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
    let maxIdNum = 0;
    spaces.forEach((s) => {
      const match = s.id.match(/^space_(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxIdNum) {
          maxIdNum = num;
        }
      }
    });
    const newId = `space_${maxIdNum + 1}`;
    const nextOrder = spaces.length > 0 ? Math.max(...spaces.map((s) => s.order)) + 1 : 0;
    const newLabel = String(nextOrder + 1);

    try {
      await saveCurrentSpace();

      await api.createSpace(workspacePath, newId, newLabel);

      const newEntry: SpaceEntry = { id: newId, label: newLabel, order: nextOrder };
      setSpaces((prev) => [...prev, newEntry]);

      // Persist the new space as active so it survives a reload (mirrors handleSwitchSpace).
      try {
        const config = await api.loadWorkspaceConfig(workspacePath);
        config.active_space = newId;
        await api.saveWorkspaceConfig(workspacePath, config);
      } catch (_err) {
        // Non-critical: in-memory switch below still takes effect this session.
      }

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
        const config = await api.loadWorkspaceConfig(workspacePath);
        const space = config.spaces.find((s: SpaceEntry) => s.id === spaceId);
        if (space) {
          space.label = newLabel;
          await api.saveWorkspaceConfig(workspacePath, config);
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
        await api.deleteSpace(workspacePath, spaceId);

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
              const config = await api.loadWorkspaceConfig(workspacePath);
              config.active_space = nextSpace.id;
              await api.saveWorkspaceConfig(workspacePath, config);
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

  // ─── Space context menu ────────────────────────────────────
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
            label: "Rename Space",
            icon: "✏️",
            onClick: () => {
              setEditingSpaceId(spaceId);
            },
          },
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
    [spaces, handleDeleteSpace, setEditingSpaceId, setContextMenu]
  );

  return {
    spaces,
    activeSpaceId,
    editingSpaceId,
    isLoading,
    setEditingSpaceId,
    loadSpaceData,
    saveCurrentSpace,
    handleSwitchSpace,
    handleAddSpace,
    handleRenameSpace,
    handleDeleteSpace,
    onSpaceContextMenu,
  };
}
