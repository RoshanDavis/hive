import type { Theme } from "./types";

/**
 * Write every slot of `theme` to a CSS custom property on `root` (default:
 * `document.documentElement`), plus set `data-theme="<id>"`. After this
 * runs, every `var(--bg-primary)` / Tailwind `bg-primary` / etc. resolves to
 * the new value — no other code paths need to be aware of theming.
 *
 * Variable names match the existing `tokens.css` `:root` so the rest of the
 * codebase doesn't need to change. Adding a new theme slot means: add a
 * field to `Theme`, write it here, and add a matching mirror in
 * `tokens.css` (for first-paint correctness).
 */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  const s = root.style;

  // Surfaces
  s.setProperty("--bg-primary", theme.surfaces.primary);
  s.setProperty("--bg-secondary", theme.surfaces.secondary);
  s.setProperty("--bg-card", theme.surfaces.card);
  s.setProperty("--bg-card-hover", theme.surfaces.cardHover);
  s.setProperty("--bg-sidebar", theme.surfaces.sidebar);
  s.setProperty("--bg-input", theme.surfaces.input);
  s.setProperty("--bg-menu", theme.surfaces.menu);
  s.setProperty("--bg-overlay", theme.surfaces.overlay);

  // Text
  s.setProperty("--text-main", theme.text.main);
  s.setProperty("--text-secondary", theme.text.secondary);
  s.setProperty("--text-muted", theme.text.muted);

  // Borders
  s.setProperty("--border-subtle", theme.borders.subtle);
  s.setProperty("--border-card", theme.borders.card);
  s.setProperty("--border-hover", theme.borders.hover);

  // Accents
  s.setProperty("--accent", theme.accents.primary);
  s.setProperty("--accent-dim", theme.accents.primaryDim);
  s.setProperty("--accent-glow", theme.accents.primaryGlow);
  s.setProperty("--accent-selection", theme.accents.selection);

  // Status (semantic)
  s.setProperty("--success", theme.status.success);
  s.setProperty("--warning", theme.status.warning);
  s.setProperty("--error", theme.status.error);
  s.setProperty("--info", theme.status.info);
  s.setProperty("--danger", theme.status.danger);
  s.setProperty("--danger-hover", theme.status.dangerHover);

  // Controls
  s.setProperty("--handle", theme.controls.handle);
  s.setProperty("--toggle-knob", theme.controls.toggleKnob);

  // Edge colors exposed as CSS variables so node plugins can use them in
  // inline styles (e.g. storage-handle background tint) without importing
  // hex constants. The browser re-evaluates `var(--edge-database)` on
  // theme switch, so handles repaint without per-handle re-rendering.
  s.setProperty("--edge-default", theme.edges.default);
  s.setProperty("--edge-database", theme.edges.database);

  // Semantic content tints (author-of-content). Used by the chat feed,
  // the chat-variant toast, the database record feed (DatabaseRecordFeed),
  // and the concurrency-pool badges in SettingsModal.
  s.setProperty("--content-user", theme.content.user);
  s.setProperty("--content-notification", theme.content.notification);
  s.setProperty("--content-system", theme.content.system);
  s.setProperty("--content-assistant", theme.content.assistant);

  root.dataset.theme = theme.id;
}
