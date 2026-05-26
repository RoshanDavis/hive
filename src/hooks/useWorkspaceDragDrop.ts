import { useCallback, useState, useEffect } from "react";
import { useReactFlow, type Node } from "@xyflow/react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { type ShowToastFunc } from "@/types/workspace";

interface UseWorkspaceDragDropParams {
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  showToast: ShowToastFunc;
}

export function useWorkspaceDragDrop({
  setNodes,
  showToast,
}: UseWorkspaceDragDropParams) {
  const [activeDragNode, setActiveDragNode] = useState<{
    type: string;
    clientX: number;
    clientY: number;
  } | null>(null);

  const reactFlowInstance = useReactFlow();

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

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      if (activeDragNode) {
        setActiveDragNode((prev) =>
          prev ? { ...prev, clientX: event.clientX, clientY: event.clientY } : null
        );
      }
    },
    [activeDragNode]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      if (!event.dataTransfer) {
        setActiveDragNode(null);
        return;
      }
      const type = event.dataTransfer.getData("application/reactflow");

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

      const plugin = pluginRegistry.get(type);
      if (!plugin) return;

      const id = `${type}_${Date.now()}`;
      const newNode: Node = {
        id,
        type,
        position,
        data: { ...plugin.defaultData },
      };

      setNodes((nds) => [...nds, newNode]);
      showToast(`Added ${plugin.meta.label} node`, "info");
    },
    [reactFlowInstance, setNodes, showToast]
  );

  return {
    activeDragNode,
    handleDragStartNode,
    handleDragEndNode,
    handleDragOver,
    handleDrop,
  };
}
