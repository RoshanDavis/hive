import { useCallback } from "react";
import {
  addEdge,
  MarkerType,
  type Node,
  type Edge,
  type OnConnect,
} from "@xyflow/react";
import { getEdges } from "@/theme/colors";
import { getConnectionBehavior } from "@/engine/connectivity";
import type { ShowToastFunc } from "@/types/workspace";

interface UseEdgeOperationsArgs {
  nodes: Node[];
  setEdges: (updater: Edge[] | ((prev: Edge[]) => Edge[])) => void;
  setSelectedEdge: (e: Edge | null | ((prev: Edge | null) => Edge | null)) => void;
  showToast: ShowToastFunc;
}

/** Build the React Flow arrow marker spec using the current theme's edge color.
 * Resolved at edge-create / edge-update time, so theme switches propagate to
 * newly-created edges immediately. */
function makeArrowMarker() {
  return {
    type: MarkerType.ArrowClosed,
    color: getEdges().default,
    width: 16,
    height: 16,
  } as const;
}

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
        const marker = makeArrowMarker();
        return addEdge(
          {
            ...params,
            type: "custom",
            data: { edgeType: defaultFlow },
            markerEnd: marker,
            markerStart: defaultFlow === "bi-directional" ? marker : undefined,
            style: { stroke: getEdges().default, strokeWidth: 2 },
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
            markerStart: edgeType === "bi-directional" ? makeArrowMarker() : undefined,
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
