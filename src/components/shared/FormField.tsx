/**
 * Shared form-styling constants for inspector / settings UI.
 *
 * Centralizes the repeated label and input className strings so the visual
 * vocabulary (especially the accent-glow focus ring) lives in one place and
 * flows through the design tokens.
 *
 * Usage:
 *   <label className={formLabelClass}>…</label>
 *   <input className={formInputClass} … />
 *   <select className={`${formInputClass} cursor-pointer`} … />
 *   <textarea className={`${formInputClass} resize-y min-h-20 font-inherit`} … />
 *
 * Use plain composition for variants. Variants that need to OVERRIDE base
 * spacing (smaller padding/text-size) should not use this — the cascade isn't
 * guaranteed when both rules have equal specificity.
 */

export const formLabelClass =
  "text-xs font-semibold uppercase tracking-wider text-text-muted";

export const formInputClass =
  "w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_var(--accent-glow)] outline-none";

/**
 * Range slider. Picks up the same focus-glow ring as inputs so keyboard
 * navigation reads consistently. The slider track itself is left to the
 * browser-default styling — Tailwind v4 doesn't ship pseudo-element utilities
 * for ::-webkit-slider-thumb without arbitrary selectors.
 */
export const formRangeClass =
  "w-full accent-[var(--accent)] cursor-pointer outline-none focus:shadow-[0_0_0_2px_var(--accent-glow)] rounded";
