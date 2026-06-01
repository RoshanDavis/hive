/**
 * Thin functional facade over the active theme for non-React consumers.
 *
 * **React components**: prefer `useTheme()` from `@/contexts/ThemeContext`
 * so they re-render on theme switch.
 *
 * **Non-React callsites** (engine helpers, React Flow's `MiniMap.nodeColor`
 * callback, edge style functions): use the functions here. They read from
 * the module-level active theme in `@/theme`, which the ThemeContext keeps
 * in sync — but they don't subscribe, so callers that need re-rendering
 * must already be inside a component that subscribes via `useTheme()`.
 *
 * Note: there are no more hardcoded hex constants or per-node colors here.
 * Per-node `meta.color` was removed; node-picker cards use the theme accent.
 */

import { getActiveTheme } from "./index";
import type { Theme } from "./types";

export function getEdges(): Theme["edges"] {
  return getActiveTheme().edges;
}

export function getCanvas(): Theme["canvas"] {
  return getActiveTheme().canvas;
}

export function getAccent(): string {
  return getActiveTheme().accents.primary;
}

export function getDatabaseColor(): string {
  return getActiveTheme().edges.database;
}

/**
 * Map a node's `data.status` to its semantic color. Used by React Flow's
 * MiniMap and any chart/badge that wants the same scheme as the in-canvas
 * status border.
 */
export function getStatusColor(status: unknown): string {
  const s = getActiveTheme().status;
  switch (status) {
    case "executing":
    case "success":
      return s.success;
    case "waiting":
      return s.warning;
    case "pending":
      return s.info;
    case "error":
      return s.error;
    default:
      return s.idle;
  }
}
