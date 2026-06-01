/**
 * Shared className strings for buttons inside the Actions dropdown of every
 * inspector. Every button uses the same dimensions, gap, and font weight so
 * they read as one family; tone (color + border style) communicates role.
 *
 * Roles:
 * - **Neutral** — the generic action style (Save as custom, Open script in
 *   editor, Clear Output, Clear Data). Subtle bg-card surface, bright text.
 * - **Primary** — the headline action of an Actions card (Run). Uses an
 *   accent-edged outline that fills solid on hover. The matching
 *   `primaryActive` variant is used while the action is in flight so the
 *   running state is unmistakable.
 * - **Danger** — destructive primary (Delete node, Delete connection).
 *   Solid danger tint from rest state so it always reads "this is the
 *   serious one".
 *
 * All roles share `BASE_LAYOUT` to guarantee the buttons line up cleanly
 * when stacked at gap-2 inside `InspectorActions`. Disabled state is uniform
 * (`opacity-40 cursor-not-allowed`) for every role except `primaryActive`,
 * where the visual signature itself communicates the active state.
 */

const BASE_LAYOUT =
  "w-full rounded-md py-2 text-xs font-semibold flex justify-center items-center gap-2 transition-colors";

const DISABLED = "disabled:opacity-40 disabled:cursor-not-allowed";

export const actionButtonNeutralClass =
  `${BASE_LAYOUT} ${DISABLED} bg-card border border-border-subtle text-text-main ` +
  `enabled:cursor-pointer enabled:hover:bg-card-hover enabled:hover:border-border-card`;

export const actionButtonPrimaryClass =
  `${BASE_LAYOUT} ${DISABLED} bg-card border border-accent text-accent ` +
  `enabled:cursor-pointer enabled:hover:bg-accent enabled:hover:text-primary ` +
  `enabled:hover:shadow-[0_0_12px_var(--accent-glow)]`;

/**
 * Use while the action is running / pending. Skips `disabled:opacity-*` so the
 * filled-accent state remains visually prominent (it's the cue that something
 * is in flight). The button should still carry `disabled` to block clicks.
 */
export const actionButtonPrimaryActiveClass =
  `${BASE_LAYOUT} border border-accent bg-accent text-primary ` +
  `shadow-[0_0_12px_var(--accent-glow)] cursor-not-allowed`;

export const actionButtonDangerClass =
  `${BASE_LAYOUT} ${DISABLED} bg-danger/10 border border-danger/30 text-danger ` +
  `enabled:cursor-pointer enabled:hover:bg-danger/20 enabled:hover:border-danger/50 ` +
  `enabled:hover:text-danger-hover`;
