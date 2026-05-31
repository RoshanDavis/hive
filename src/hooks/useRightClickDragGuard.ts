import { useCallback, useRef } from "react";

/**
 * Distinguishes a right-click from a right-click-and-drag (which React Flow
 * uses to pan the canvas). We track the right-button mouse-down position and
 * call `wasRightClickDrag(event)` from each context-menu handler — if the
 * cursor moved more than 5px between mouse-down and the menu trigger, we
 * suppress the menu so the user just sees the pan.
 *
 * Returns:
 * - `handleMouseDown`: wire to the canvas wrapper's `onMouseDown`.
 * - `wasRightClickDrag`: call at the top of every context-menu handler;
 *   resets internal state after returning, so it's a one-shot per gesture.
 */
export function useRightClickDragGuard() {
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
    rightClickStartRef.current = null;
    return dist > 5;
  }, []);

  return { handleMouseDown, wasRightClickDrag };
}
