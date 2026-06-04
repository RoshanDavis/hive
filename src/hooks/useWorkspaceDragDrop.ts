import { useCallback, useState, useEffect, useRef } from "react";
import { useReactFlow, type Node } from "@xyflow/react";
import { pluginRegistry } from "@/engine/pluginRegistry";
import { type ShowToastFunc } from "@/types/workspace";
import type { AgentSlotKind } from "@/nodes/types";

// ─── Agent slot drag-to-fill helpers ─────────────────────────
// Dropping a node onto an Agent's dotted slot box fills that slot (a copy of the
// node's config in the agent's data) instead of nesting/relocating the node.
// Works for two gestures: dragging a type from the palette (handleDrop) and
// dragging an existing canvas node onto a slot (handleNodeDragStop). Slot boxes
// stamp `data-agent-slot` / `data-agent-id` (see AgentNodeView).

/**
 * Resolve the agent slot whose box contains a screen point by scanning slot-box
 * rects directly. Robust during a canvas node-drag — the dragged node sits on
 * top of the cursor, so `elementFromPoint` would return it, not the slot
 * beneath. Ghost slot boxes carry an empty agent id and are skipped.
 */
function findAgentSlotByRect(
  x: number,
  y: number
): { agentId: string; slot: AgentSlotKind } | null {
  const boxes = document.querySelectorAll<HTMLElement>("[data-agent-slot][data-agent-id]");
  for (const box of boxes) {
    const agentId = box.dataset.agentId;
    const slot = box.dataset.agentSlot as AgentSlotKind | undefined;
    if (!agentId || !slot) continue;
    const r = box.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return { agentId, slot };
    }
  }
  return null;
}

/** Whether a node type can fill a given slot (custom presets resolve via baseType). */
function isTypeCompatibleWithSlot(slot: AgentSlotKind, type: string): boolean {
  const plugin = pluginRegistry.get(type);
  if (!plugin) return false;
  const baseType = plugin.baseType ?? type;
  if (slot === "llm") return baseType === "llm";
  if (slot === "storage") return plugin.meta.category === "storage";
  return baseType === "toolsContainer";
}

const LLM_SLOT_KEYS = [
  "provider",
  "baseURL",
  "credentialId",
  "modelName",
  "systemPrompt",
  "temperature",
  "maxTokens",
  "chatHistoryLimit",
] as const;

/**
 * Build the value to store in an agent slot from a source node's data — either a
 * palette default or an existing canvas node. Copies only slot-relevant config,
 * never transient run state (status / outputEnvelope / cached input), so the
 * agent doesn't inherit stale runtime data.
 */
function buildAgentSlotValue(
  slot: AgentSlotKind,
  sourceData: Record<string, unknown>
): Record<string, unknown> {
  if (slot === "llm") {
    const v: Record<string, unknown> = {};
    for (const k of LLM_SLOT_KEYS) {
      if (sourceData[k] !== undefined) v[k] = sourceData[k];
    }
    return v;
  }
  if (slot === "storage") {
    // Adopt a dragged jsonStorage node's existing records as the agent's memory;
    // conversation + runData start empty.
    return {
      kind: "jsonStorage",
      conversation: [],
      memory: Array.isArray(sourceData.records) ? sourceData.records : [],
      runData: [],
    };
  }
  const tools: Record<string, unknown> = {
    native: Array.isArray(sourceData.native) ? sourceData.native : [],
    mcp: Array.isArray(sourceData.mcp) ? sourceData.mcp : [],
    skills: Array.isArray(sourceData.skills) ? sourceData.skills : [],
  };
  // Carry per-tool config (e.g. the bound web_search credential) when present.
  if (sourceData.toolSettings && typeof sourceData.toolSettings === "object") {
    tools.toolSettings = sourceData.toolSettings;
  }
  return tools;
}

interface UseWorkspaceDragDropParams {
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  showToast: ShowToastFunc;
  /** Returns the merged global+workspace overrides for a plugin type. */
  getMergedOverrides?: (type: string) => Record<string, unknown>;
}

export function useWorkspaceDragDrop({
  setNodes,
  showToast,
  getMergedOverrides,
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

      // Drag-onto-placeholder: dropped over an Agent slot that accepts this type
      // → fill the slot (agent data) instead of creating a free-floating node.
      const slotHit = findAgentSlotByRect(event.clientX, event.clientY);
      if (slotHit && isTypeCompatibleWithSlot(slotHit.slot, type)) {
        const slotPlugin = pluginRegistry.get(type);
        const merged = {
          ...(slotPlugin?.defaultData ?? {}),
          ...(getMergedOverrides ? getMergedOverrides(type) : {}),
        };
        const slotValue = buildAgentSlotValue(slotHit.slot, merged);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === slotHit.agentId
              ? { ...n, data: { ...n.data, [slotHit.slot]: slotValue } }
              : n
          )
        );
        setActiveDragNode(null);
        showToast(
          `Added ${slotPlugin?.meta.label ?? type} to the Agent's ${slotHit.slot} slot`,
          "info"
        );
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
      const overrides = getMergedOverrides ? getMergedOverrides(type) : {};
      const newNode: Node = {
        id,
        type,
        position,
        data: { ...plugin.defaultData, ...overrides },
      };

      setNodes((nds) => [...nds, newNode]);
      showToast(`Added ${plugin.meta.label} node`, "info");
    },
    [reactFlowInstance, setNodes, showToast, getMergedOverrides]
  );

  // ─── Dragging an existing canvas node onto an Agent slot ─────
  // Copies the node's config into the matching slot and snaps the node back to
  // where it started (it is adopted as config, not nested/relocated).
  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  const handleNodeDragStart = useCallback((_event: React.MouseEvent, node: Node) => {
    dragStartPositions.current.set(node.id, { x: node.position.x, y: node.position.y });
  }, []);

  const handleNodeDragStop = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const start = dragStartPositions.current.get(node.id);
      dragStartPositions.current.delete(node.id);

      // An agent is the container, not a slot value — never absorb one.
      if (node.type === "agent") return;

      const slotHit = findAgentSlotByRect(event.clientX, event.clientY);
      if (!slotHit || slotHit.agentId === node.id) return;
      if (!isTypeCompatibleWithSlot(slotHit.slot, node.type || "")) return;

      const slotValue = buildAgentSlotValue(slotHit.slot, node.data ?? {});

      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === slotHit.agentId) {
            return { ...n, data: { ...n.data, [slotHit.slot]: slotValue } };
          }
          // Snap the source node back — its config was copied, not relocated.
          if (n.id === node.id && start) {
            return { ...n, position: start };
          }
          return n;
        })
      );

      const plugin = pluginRegistry.get(node.type || "");
      showToast(
        `Updated the Agent's ${slotHit.slot} slot from ${plugin?.meta.label ?? node.type}`,
        "info"
      );
    },
    [setNodes, showToast]
  );

  return {
    activeDragNode,
    handleDragStartNode,
    handleDragEndNode,
    handleDragOver,
    handleDrop,
    handleNodeDragStart,
    handleNodeDragStop,
  };
}
