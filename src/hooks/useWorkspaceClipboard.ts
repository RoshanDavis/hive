import { useCallback, useEffect } from "react";
import { type Node, type Edge, useReactFlow } from "@xyflow/react";
import { api } from "@/services/api";
import { storage } from "@/services/storage";
import { type ShowToastFunc } from "@/types/workspace";

interface UseWorkspaceClipboardProps {
  nodes: Node[];
  edges: Edge[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  selectedNode: Node | null;
  setSelectedNode: (node: Node | null) => void;
  workspacePath: string;
  activeSpaceId: string;
  showToast: ShowToastFunc;
}

export function useWorkspaceClipboard({
  nodes,
  edges,
  setNodes,
  setEdges,
  selectedNode,
  setSelectedNode,
  workspacePath,
  activeSpaceId,
  showToast,
}: UseWorkspaceClipboardProps) {
  const reactFlowInstance = useReactFlow();

  const deleteSelected = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected);
    const selectedEdges = edges.filter((e) => e.selected);
    if (selectedNodes.length === 0 && selectedEdges.length === 0) return;

    selectedNodes.forEach((node) => {
      if (node.type === "jsonStorage") {
        api.deleteStorageHistory(workspacePath, activeSpaceId, node.id).catch((err) => {
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
  }, [nodes, edges, selectedNode, workspacePath, activeSpaceId, setNodes, setEdges, showToast, setSelectedNode]);

  const copySelection = useCallback((withData: boolean = false) => {
    const selectedNodes = nodes.filter((n) => n.selected);
    if (selectedNodes.length === 0) return;

    const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));
    const connectedEdges = edges.filter(
      (e) => selectedNodeIds.has(e.source) && selectedNodeIds.has(e.target)
    );

    const processedNodes = selectedNodes.map((node) => {
      if (withData) return node;

      const cleanData = { ...node.data };
      
      if (node.type === "chat") {
        cleanData.messages = [];
      } else if (node.type === "ollama" || node.type === "llm") {
        delete cleanData.lastResponse;
      } else if (node.type === "output" || node.type === "outputNode") {
        cleanData.outputContent = "";
        delete cleanData.lastResponse;
      } else if (node.type === "jsonStorage") {
        cleanData.records = [];
      } else if (node.type === "notify") {
        delete cleanData.lastResponse;
      }

      return {
        ...node,
        data: cleanData
      };
    });

    const clipboardData = {
      nodes: processedNodes,
      edges: connectedEdges,
      copiedWithData: withData,
    };

    storage.setClipboard(clipboardData);
    showToast(
      `Copied ${selectedNodes.length} node(s) as ${withData ? "complete copy" : "template"}`,
      "info"
    );
  }, [nodes, edges, showToast]);

  const cutSelection = useCallback((withData: boolean = false) => {
    const selectedNodes = nodes.filter((n) => n.selected);
    if (selectedNodes.length === 0) return;

    copySelection(withData);
    deleteSelected();
  }, [nodes, copySelection, deleteSelected]);

  const pasteSelection = useCallback((clientX?: number, clientY?: number) => {
    const clipboardData = storage.getClipboard();
    if (!clipboardData || !Array.isArray(clipboardData.nodes)) return;

    try {
      const clipboardNodes = clipboardData.nodes as Node[];
      const clipboardEdges = (clipboardData.edges || []) as Edge[];

      if (clipboardNodes.length === 0) return;

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

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (isCmdOrCtrl && e.key.toLowerCase() === "c") {
        e.preventDefault();
        if (e.shiftKey) {
          copySelection(true);
        } else {
          copySelection(false);
        }
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === "x") {
        e.preventDefault();
        if (e.shiftKey) {
          cutSelection(true);
        } else {
          cutSelection(false);
        }
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

  return {
    copySelection,
    cutSelection,
    pasteSelection,
    deleteSelected,
  };
}
