/**
 * Single source of truth for colors consumed in JS/TS — React Flow canvas
 * chrome, node identity, and plugin handle styles. These mirror the matching
 * CSS custom properties in src/App.css (--accent, --info, --node-*, surfaces).
 *
 * NOTE: these are plain JS strings handed to React Flow, so unlike the CSS
 * token layer they do NOT live-swap on a future runtime theme change — wiring
 * that up would mean reading the computed CSS variables at render time.
 */

export const ACCENT = "#d4e600";
export const DATABASE = "#38bdf8"; // storage / database edges + handles

/** Node identity colors — mirror of the --node-* tokens in App.css. */
export const NODE_COLORS = {
  trigger: "#d4e600",
  notify: "#60a5fa",
  ollama: "#a78bfa",
  llm: "#a78bfa",
  chat: "#34d399",
  output: "#fb923c",
} as const;

/** Fallback for a node type with no declared color. */
export const NODE_FALLBACK = "#888888";

/** React Flow MiniMap + background chrome. */
export const CANVAS = {
  backgroundDots: "#333333",
  minimapMask: "rgba(0, 0, 0, 0.7)",
  minimapBg: "#1a1a1a",
  minimapBorder: "#2a2a2a",
} as const;

/** Edge stroke + selection glow. */
export const EDGE = {
  default: ACCENT,
  database: DATABASE,
  glowDefault: "drop-shadow(0 0 4px rgba(212, 230, 0, 0.6))",
  glowDatabase: "drop-shadow(0 0 4px rgba(56, 189, 248, 0.65))",
} as const;
