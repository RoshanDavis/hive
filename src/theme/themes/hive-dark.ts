import type { Theme } from "../types";

/**
 * The current dark theme — these values were previously split between
 * `tokens.css` `:root` and the hex constants in `colors.ts`. They are now
 * authoritative HERE; `tokens.css` keeps a mirror of these values under
 * `:root` purely as a first-paint fallback before JS runs `applyTheme()`. If
 * you change a value here, mirror it in `tokens.css` too — there is no
 * automated check yet.
 */
export const hiveDark: Theme = {
  id: "hive-dark",
  name: "Hive Dark",

  surfaces: {
    primary: "#0a0a0a",
    secondary: "#111111",
    card: "#1a1a1a",
    cardHover: "#222222",
    sidebar: "#0f0f0f",
    input: "#1e1e1e",
    menu: "#121212",
  },

  text: {
    main: "#f0f0f0",
    secondary: "#888888",
    muted: "#555555",
  },

  borders: {
    subtle: "#2a2a2a",
    card: "#333333",
  },

  accents: {
    primary: "#d4e600",
    primaryDim: "#a3b300",
    primaryGlow: "rgba(212, 230, 0, 0.15)",
  },

  status: {
    success: "#22c55e",
    warning: "#eab308",
    error: "#ef4444",
    info: "#38bdf8",
    danger: "#ff6b6b",
    idle: "#52525b",
  },

  edges: {
    default: "#d4e600",
    database: "#38bdf8",
    glowDefault: "drop-shadow(0 0 4px rgba(212, 230, 0, 0.6))",
    glowDatabase: "drop-shadow(0 0 4px rgba(56, 189, 248, 0.65))",
  },

  canvas: {
    backgroundDots: "#333333",
    minimapMask: "rgba(0, 0, 0, 0.7)",
    minimapBg: "#1a1a1a",
    minimapBorder: "#2a2a2a",
  },

  controls: {
    handle: "#444444",
  },

  content: {
    user: "#34d399",
    notification: "#60a5fa",
  },
};
