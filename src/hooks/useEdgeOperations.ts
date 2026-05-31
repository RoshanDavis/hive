import { useCallback } from "react";
import {
  addEdge,
  MarkerType,
  type Node,
  type Edge,
  type OnConnect,
} from "@xyflow/react";
import { EDGE } from "@/theme/colors";
import { getConnectionBehavior } from "@/engine/connectivity";
import type { ShowToastFunc } from "@/types/workspace";

interface UseEdgeOperationsArgs {
  nodes: Node[];
  setEdges: (updater: Edge[] | ((prev: Edge[]) => Edge[])) => void;
  setSelectedEdge: (e: Edge | null | ((prev: Edge | null) => Edge | null)) => void;
  showToast: ShowToastFunc;
}

const ARROW_MARKER = {
  type: MarkerType.ArrowClosed,
  color: EDGE.default,
  width: 16,
  height: 16,
} as const;

/**
 * Owns edge creation, edge-type changes, and edge deletion. Keeps the marker
 * + style choices in one place so future edge-rendering changes don't need to
 * touch the editor.
 */
export function useEdgeOperations({
  nodes,
  setEdges,
  setSelectedEdge,
  showToast,
}: UseEdgeOperationsArgs) {
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
            data: { edgeType: defaultFlow },
            markerEnd: ARROW_MARKER,
            markerStart: defaultFlow === "bi-directional" ? ARROW_MARKER : undefined,
            style: { stroke: EDGE.default, strokeWidth: 2 },
          },
          eds
        );
      }),
    [setEdges, nodes]
  );

  const handleUpdateEdgeData = useCallback(
    (edgeId: string, edgeType: string) => {
      setEdges((eds) =>
        eds.map((e) => {
          if (e.id !== edgeId) return e;
          return {
            ...e,
            data: { ...e.data, edgeType },
            markerStart: edgeType === "bi-directional" ? ARROW_MARKER : undefined,
          };
        })
      );
      setSelectedEdge((prev) =>
        prev && prev.id === edgeId
          ? { ...prev, data: { ...prev.data, edgeType } }
          : prev
      );
    },
    [setEdges, setSelectedEdge]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      setSelectedEdge(null);
      showToast("Connection deleted", "info");
    },
    [setEdges, setSelectedEdge, showToast]
  );

  return { onConnect, handleUpdateEdgeData, handleDeleteEdge };
}
