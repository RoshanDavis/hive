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
  "w-full bg-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-main transition-colors focus:border-accent-dim focus:shadow-[0_0_0_2px_var(--accent-glow)] outline-hidden";

/**
 * Range slider. Picks up the same focus-glow ring as inputs so keyboard
 * navigation reads consistently. The slider track itself is left to the
 * browser-default styling — Tailwind v4 doesn't ship pseudo-element utilities
 * for ::-webkit-slider-thumb without arbitrary selectors.
 */
export const formRangeClass =
  "w-full accent-[var(--accent)] cursor-pointer outline-hidden focus:shadow-[0_0_0_2px_var(--accent-glow)] rounded";

/**
 * One segment of a horizontal segmented toggle (a row of mutually-exclusive
 * choice buttons that fill their container, e.g. transport / scope / HTTP-vs-script
 * pickers). `active` styles the selected segment with the accent treatment.
 */
export const segmentedButtonClass = (active: boolean): string =>
  `flex-1 rounded-md border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
    active
      ? "border-accent bg-accent-glow text-accent"
      : "border-border-subtle bg-card text-text-secondary hover:bg-card-hover"
  }`;
