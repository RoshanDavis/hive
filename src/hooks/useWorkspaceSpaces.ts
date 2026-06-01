import { useCallback, useEffect } from "react";
import { useReactFlow, type Node } from "@xyflow/react";
import { api } from "@/services/api";
import {
  type SpaceEntry,
  type ContextMenuState,
  type ShowToastFunc,
} from "@/types/workspace";
import { type RunnerSession } from "@/contexts/runnerSession";

interface UseWorkspaceSpacesParams {
  session: RunnerSession;
  workspacePath: string;
  spaces: SpaceEntry[];
  activeSpaceId: string;
  editingSpaceId: string | null;
  isLoading: boolean;
  setSelectedNode: React.Dispatch<React.SetStateAction<Node | null>>;
  showToast: ShowToastFunc;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
}

/**
 * Spaces-management view bound to the session. The canonical state (spaces,
 * activeSpaceId, nodes/edges) lives on the session; this hook just exposes
 * stable callbacks that delegate to it. The 800ms debounced auto-save lives
 * on the session so it keeps firing while the editor is unmounted (background
 * execution).
 */
export function useWorkspaceSpaces({
  session,
  workspacePath,
  spaces,
  activeSpaceId,
  editingSpaceId: _editingSpaceId,
  isLoading,
  setSelectedNode,
  showToast,
  setContextMenu,
}: UseWorkspaceSpacesParams) {
  const reactFlowInstance = useReactFlow();

  // Restore the persisted viewport once the session finishes loading. The
  // session keeps the viewport but doesn't poke ReactFlow directly (that
  // would require a hook). On (re-)attach the editor mounts and we apply
  // the viewport back to ReactFlow.
  useEffect(() => {
    if (isLoading) return;
    const snap = session.getSnapshot();
    if (snap.viewport.zoom > 0) {
      const t = setTimeout(() => {
        reactFlowInstance.setViewport(snap.viewport);
      }, 50);
      return () => clearTimeout(t);
    }
  }, [isLoading, session, reactFlowInstance]);

  const setEditingSpaceId = useCallback(
    (id: string | null) => session.setEditingSpaceId(id),
    [session]
  );

  const saveCurrentSpace = useCallback(async () => {
    await session.flushSave();
  }, [session]);

  const handleSwitchSpace = useCallback(
    async (newSpaceId: string) => {
      if (newSpaceId === activeSpaceId) return;
      // Flush any pending writes for every dirty space (including a
      // backgrounded one whose run loop is mid-stream). With per-space slots
      // the session retains the previous space's state in memory, so this
      // is purely a "make disk match RAM" step.
      await session.flushSave();
      // Hydrate the new slot BEFORE flipping the active pointer so the
      // canvas swap is atomic: no transient empty-canvas frame. Idempotent
      // — a no-op if a workflow has already kept this slot warm in memory.
      await session.loadSpaceData(newSpaceId);
      session.setActiveSpaceId(newSpaceId);
      setSelectedNode(null);
      try {
        const config = await api.loadWorkspaceConfig(workspacePath);
        config.active_space = newSpaceId;
        await api.saveWorkspaceConfig(workspacePath, config);
      } catch (_err) {
        // Non-critical
      }
    },
    [activeSpaceId, session, setSelectedNode, workspacePath]
  );

  const handleAddSpace = useCallback(async () => {
    let maxIdNum = 0;
    spaces.forEach((s) => {
      const match = s.id.match(/^space_(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxIdNum) maxIdNum = num;
      }
    });
    const newId = `space_${maxIdNum + 1}`;
    const nextOrder = spaces.length > 0 ? Math.max(...spaces.map((s) => s.order)) + 1 : 0;
    const newLabel = String(nextOrder + 1);

    try {
      await session.flushSave();
      await api.createSpace(workspacePath, newId, newLabel);

      const newEntry: SpaceEntry = { id: newId, label: newLabel, order: nextOrder };
      session.setSpaces((prev) => [...prev, newEntry]);

      try {
        const config = await api.loadWorkspaceConfig(workspacePath);
        config.active_space = newId;
        await api.saveWorkspaceConfig(workspacePath, config);
      } catch (_err) {
        // Non-critical
      }

      session.setActiveSpaceId(newId);
      setSelectedNode(null);
      session.setNodes([]);
      session.setEdges([]);

      showToast(`Created space ${newLabel}`, "info");
    } catch (err) {
      showToast(`Failed to create space: ${err}`, "error");
    }
  }, [spaces, workspacePath, session, setSelectedNode, showToast]);

  const handleRenameSpace = useCallback(
    async (spaceId: string, newLabel: string) => {
      session.setSpaces((prev) =>
        prev.map((s) => (s.id === spaceId ? { ...s, label: newLabel } : s))
      );

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
    [session, workspacePath]
  );

  const handleDeleteSpace = useCallback(
    async (spaceId: string) => {
      if (spaces.length <= 1) {
        showToast("Cannot delete the only remaining space", "error");
        return;
      }

      try {
        await api.deleteSpace(workspacePath, spaceId);

        const updatedSpaces = spaces.filter((s) => s.id !== spaceId);
        session.setSpaces(updatedSpaces);

        if (activeSpaceId === spaceId) {
          const nextSpace = updatedSpaces[0];
          if (nextSpace) {
            // Pre-hydrate the next slot before flipping the active pointer
            // so the canvas swap is atomic. Also drop the deleted space's
            // in-memory state (and any active runs there) — its file is
            // gone, so anything left in the session is garbage.
            await session.loadSpaceData(nextSpace.id);
            session.setActiveSpaceId(nextSpace.id);
            setSelectedNode(null);
            session.removeSpaceState(spaceId);
            try {
              const config = await api.loadWorkspaceConfig(workspacePath);
              config.active_space = nextSpace.id;
              await api.saveWorkspaceConfig(workspacePath, config);
            } catch (_err) {
              // Non-critical
            }
          }
        } else {
          // Deleting a non-active space: just drop its in-memory state.
          session.removeSpaceState(spaceId);
        }

        showToast("Space deleted", "info");
      } catch (err) {
        showToast(`Failed to delete space: ${err}`, "error");
      }
    },
    [spaces, activeSpaceId, workspacePath, session, setSelectedNode, showToast]
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
            label: "Rename Space",
            icon: "✏️",
            onClick: () => {
              session.setEditingSpaceId(spaceId);
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
    [spaces, handleDeleteSpace, setContextMenu, session]
  );

  return {
    setEditingSpaceId,
    saveCurrentSpace,
    handleSwitchSpace,
    handleAddSpace,
    handleRenameSpace,
    handleDeleteSpace,
    onSpaceContextMenu,
  };
}
