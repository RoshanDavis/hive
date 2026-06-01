/**
 * Theme schema.
 *
 * A `Theme` is the single source of truth for every visual color value in the
 * app. `applyTheme(theme)` writes each slot to a CSS custom property on
 * `document.documentElement`, so CSS (`var(--bg-primary)`, Tailwind utilities
 * via the `@theme` mapping in `tokens.css`) and JS consumers
 * (`getStatusColor`, React Flow's MiniMap/edges) both end up reading the same
 * source. Theme switching is just "replace the active Theme object + re-apply."
 *
 * Future user-defined themes are JSON serializations of this shape — keep
 * every field a plain string so the schema round-trips through `serde_json`
 * unchanged if/when persistence lands.
 *
 * **No node-identity colors.** Built-in nodes used to declare a per-type
 * color (`NODE_COLORS.trigger`, etc.); that's gone. Cards and icons in the
 * picker UI use the theme accent for their glow, so theme switching cascades
 * naturally to those surfaces.
 */

export interface ThemeSurfaces {
  primary: string;
  secondary: string;
  card: string;
  cardHover: string;
  sidebar: string;
  input: string;
  menu: string;
  /** Modal scrim / dimming layer. */
  overlay: string;
}

export interface ThemeText {
  main: string;
  secondary: string;
  muted: string;
}

export interface ThemeBorders {
  subtle: string;
  card: string;
  /** Hover variant — between subtle and card, used to lift strokes on hover
   *  without abusing text or accent colors. */
  hover: string;
}

export interface ThemeAccents {
  /** Primary accent — used for edges, focus rings, picker glows. */
  primary: string;
  /** A darker variant for hover/pressed states. */
  primaryDim: string;
  /** rgba/alpha variant used for soft glow backgrounds. */
  primaryGlow: string;
  /** Color of the ring around a selected node on the canvas. */
  selection: string;
}

export interface ThemeStatus {
  success: string;
  warning: string;
  error: string;
  info: string;
  /** Used by destructive action buttons (Delete). */
  danger: string;
  /** Hover variant of danger — destructive button hover state. */
  dangerHover: string;
  /** Neutral / no-status idle state (MiniMap fallback, etc.). */
  idle: string;
}

export interface ThemeEdges {
  default: string;
  database: string;
  /** CSS `filter` string for default-edge glow. */
  glowDefault: string;
  /** CSS `filter` string for storage-edge glow. */
  glowDatabase: string;
}

export interface ThemeCanvas {
  backgroundDots: string;
  minimapMask: string;
  minimapBg: string;
  minimapBorder: string;
}

export interface ThemeControls {
  /** Default React Flow handle color. */
  handle: string;
  /** Movable knob on toggle switches (Dashboard background-execution toggle,
   *  LLMInspector chat-history toggle). */
  toggleKnob: string;
}

/**
 * Drop-shadow elevations. Every named slot is a full CSS `box-shadow` value
 * (one or more layers) so a future light theme can swap the entire shadow —
 * not just its color — to match its visual weight. Depth + tint live together
 * here because changing one without the other looks wrong.
 */
export interface ThemeShadows {
  /** Resting card elevation. Also reused as the static base layer underneath
   *  status pulse glows in `reactflow.css`. */
  card: string;
  /** Dashboard workspace card lifted state. */
  cardHover: string;
  /** Palette card / NodeGridCard hover lift. */
  paletteHover: string;
  /** Settings concurrency-card hover. */
  concurrencyHover: string;
  /** Settings concurrency-add (dashed) card hover — intentionally softer. */
  concurrencyAddHover: string;
  /** Context menu / dropdown drop, with inset top highlight. */
  menu: string;
  /** Settings modal container — deepest, with inset 1px border. */
  modal: string;
  /** React Flow drag ghost — strongest, used while dragging a palette card. */
  dragGhost: string;
  /** Base toast shadow (non-variant). */
  toast: string;
  /** Outer drop layer used by variant toasts (success/error/info) on top of
   *  their color-mix tinted halo. */
  toastOuter: string;
}

/**
 * Semantic *content* colors — author-of-content tints used by the chat history
 * feed, the chat-toast variant, and the concurrency-pool badges. Distinct from
 * `status` (which is workflow execution state) and from the dropped per-node
 * identity colors.
 */
export interface ThemeContent {
  /** "User"-authored content: chat user messages, chat-variant toast. */
  user: string;
  /** Notification-authored content: notify records in the feed. */
  notification: string;
  /** System-authored content: system records in the feed. */
  system: string;
  /** Assistant/model-authored content: LLM/Ollama records in the feed. */
  assistant: string;
}

export interface Theme {
  /** Stable id (used for the `[data-theme]` attribute + localStorage key). */
  id: string;
  /** Human-readable name surfaced in the future theme switcher. */
  name: string;

  surfaces: ThemeSurfaces;
  text: ThemeText;
  borders: ThemeBorders;
  accents: ThemeAccents;
  status: ThemeStatus;
  edges: ThemeEdges;
  canvas: ThemeCanvas;
  controls: ThemeControls;
  content: ThemeContent;
  shadows: ThemeShadows;
}
