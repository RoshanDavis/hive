import { useCallback } from "react";
import type { Node, Edge } from "@xyflow/react";
import { api } from "@/services/api";
import { storage } from "@/services/storage";
import { pluginRegistry } from "@/engine/pluginRegistry";
import type { ContextMenuItem } from "@/components/ContextMenu";
import type { ContextMenuState, ShowToastFunc } from "@/types/workspace";

/**
 * Per-side-effect helper: when a node is deleted, fire-and-forget the
 * matching backend cleanup (storage history for storage nodes, chat history
 * for chat nodes). Centralized so node-deletion happens the same way from
 * every context-menu entry point.
 */
function fireDeleteSideEffects(
  node: Node,
  workspacePath: string,
  activeSpaceId: string
): void {
  const plugin = pluginRegistry.get(node.type || "");
  if (plugin?.meta.category === "storage") {
    api.deleteStorageHistory(workspacePath, activeSpaceId, node.id).catch((err) => {
      console.error("Failed to delete storage history:", err);
    });
  }
  if (node.type === "chat" || plugin?.baseType === "chat") {
    api.deleteChatHistory(workspacePath, activeSpaceId, node.id).catch((err) => {
      console.error("Failed to delete chat history:", err);
    });
  }
}

interface UseWorkspaceContextMenusArgs {
  nodes: Node[];
  selectedNode: Node | null;
  setSelectedNode: (n: Node | null) => void;
  setNodes: (updater: Node[] | ((prev: Node[]) => Node[])) => void;
  setEdges: (updater: Edge[] | ((prev: Edge[]) => Edge[])) => void;
  setContextMenu: (state: ContextMenuState | null) => void;
  copySelection: (withData: boolean) => void;
  cutSelection: (withData: boolean) => void;
  deleteSelected: () => void;
  pasteSelection: (x: number, y: number) => void;
  workspacePath: string;
  activeSpaceId: string;
  showToast: ShowToastFunc;
  wasRightClickDrag: (event: MouseEvent | React.MouseEvent) => boolean;
}

/**
 * Owns the three right-click context menus on the canvas (node / edge /
 * pane). Also exposes `deleteSingleNode` so the keyboard-delete and any
 * other callers can use the same cleanup-aware removal path. The hook is a
 * pure orchestrator — it composes existing clipboard + session callbacks
 * passed in by the editor.
 */
export function useWorkspaceContextMenus({
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
}: UseWorkspaceContextMenusArgs) {
  /** Remove one node (and its incident edges), running the storage/chat
   * cleanup side effects for the matching plugin category. */
  const deleteSingleNode = useCallback(
    (node: Node) => {
      fireDeleteSideEffects(node, workspacePath, activeSpaceId);
      setNodes((nds) => nds.filter((n) => n.id !== node.id));
      setEdges((eds) => eds.filter((e) => e.source !== node.id && e.target !== node.id));
      if (selectedNode?.id === node.id) setSelectedNode(null);
      showToast("Node deleted", "info");
    },
    [workspacePath, activeSpaceId, setNodes, setEdges, selectedNode, setSelectedNode, showToast]
  );

  /** Items for "one or more selected nodes". `count === 1` swaps singular labels. */
  const selectionItems = useCallback(
    (count: number, deleteHandler: () => void): ContextMenuItem[] => [
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
        onClick: deleteHandler,
      },
    ],
    [copySelection, cutSelection]
  );

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      event.stopPropagation();
      if (wasRightClickDrag(event)) return;

      const selectedNodes = nodes.filter((n) => n.selected);
      const isClickedSelected = selectedNodes.some((n) => n.id === node.id);
      const count = isClickedSelected ? selectedNodes.length : 1;

      if (!isClickedSelected) {
        setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === node.id })));
      }

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: selectionItems(count, () => {
          if (count > 1) deleteSelected();
          else deleteSingleNode(node);
        }),
      });
    },
    [nodes, setNodes, setContextMenu, wasRightClickDrag, selectionItems, deleteSelected, deleteSingleNode]
  );

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
    [setEdges, showToast, setContextMenu, wasRightClickDrag]
  );

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
        items.push(...selectionItems(count, () => deleteSelected()));
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

      setContextMenu({ x: event.clientX, y: event.clientY, items });
    },
    [nodes, selectionItems, deleteSelected, pasteSelection, setNodes, setEdges, showToast, setContextMenu, wasRightClickDrag]
  );

  /** Catches right-clicks on the wrapper above ReactFlow — used so the
   * selection-overlay (which sits on top of the canvas) still surfaces the
   * selection actions menu instead of falling through to the browser. */
  const handleWrapperContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (event.isPropagationStopped()) return;
      const selectedNodes = nodes.filter((n) => n.selected);
      const count = selectedNodes.length;
      if (count < 1) return;

      event.preventDefault();
      event.stopPropagation();
      if (wasRightClickDrag(event)) return;

      const singleNode = selectedNodes[0];
      const items: ContextMenuItem[] = selectionItems(count, () => {
        if (count > 1) deleteSelected();
        else deleteSingleNode(singleNode);
      });

      if (count > 1) {
        items.push({
          label: "Select All Nodes",
          icon: "✨",
          onClick: () => {
            setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
            setEdges((eds) => eds.map((e) => ({ ...e, selected: true })));
            showToast("Selected all elements", "info");
          },
        });
      }

      setContextMenu({ x: event.clientX, y: event.clientY, items });
    },
    [nodes, selectionItems, deleteSelected, deleteSingleNode, setNodes, setEdges, showToast, setContextMenu, wasRightClickDrag]
  );

  return {
    onNodeContextMenu,
    onEdgeContextMenu,
    onPaneContextMenu,
    handleWrapperContextMenu,
    deleteSingleNode,
  };
}
