/**
 * Drift guard for the `tokens.css` ↔ `hive-dark.ts` mirror.
 *
 * `tokens.css` `:root` exists solely to provide a first-paint fallback before
 * `ThemeProvider` runs `applyTheme(hiveDark)`. Its values must match the
 * authoritative dark theme exactly — otherwise the app flashes one set of
 * colors and then snaps to another. There is no runtime mechanism to keep
 * the two in sync, so this test catches drift at `npm run test` time.
 *
 * If you add a new CSS variable to either file, add a row to MIRROR_MAP.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hiveDark } from "@/theme/themes/hive-dark";

/**
 * Pairs of CSS variable name (without the `--` prefix) to the JS path that
 * resolves to its expected value on the active theme object.
 */
const MIRROR_MAP: Array<[varName: string, themeValue: string]> = [
  // Surfaces
  ["bg-primary", hiveDark.surfaces.primary],
  ["bg-secondary", hiveDark.surfaces.secondary],
  ["bg-card", hiveDark.surfaces.card],
  ["bg-card-hover", hiveDark.surfaces.cardHover],
  ["bg-sidebar", hiveDark.surfaces.sidebar],
  ["bg-input", hiveDark.surfaces.input],
  ["bg-menu", hiveDark.surfaces.menu],
  ["bg-overlay", hiveDark.surfaces.overlay],

  // Controls
  ["handle", hiveDark.controls.handle],
  ["toggle-knob", hiveDark.controls.toggleKnob],

  // Accent
  ["accent", hiveDark.accents.primary],
  ["accent-dim", hiveDark.accents.primaryDim],
  ["accent-glow", hiveDark.accents.primaryGlow],
  ["accent-selection", hiveDark.accents.selection],

  // Text
  ["text-main", hiveDark.text.main],
  ["text-secondary", hiveDark.text.secondary],
  ["text-muted", hiveDark.text.muted],

  // Borders
  ["border-subtle", hiveDark.borders.subtle],
  ["border-card", hiveDark.borders.card],
  ["border-hover", hiveDark.borders.hover],

  // Status
  ["success", hiveDark.status.success],
  ["warning", hiveDark.status.warning],
  ["error", hiveDark.status.error],
  ["info", hiveDark.status.info],
  ["danger", hiveDark.status.danger],
  ["danger-hover", hiveDark.status.dangerHover],

  // Edges
  ["edge-default", hiveDark.edges.default],
  ["edge-database", hiveDark.edges.database],

  // Content
  ["content-user", hiveDark.content.user],
  ["content-notification", hiveDark.content.notification],
  ["content-system", hiveDark.content.system],
  ["content-assistant", hiveDark.content.assistant],

  // Shadows (declared in the @theme block so Tailwind also emits utility
  // classes; the parser below reads both :root and @theme into one map).
  ["shadow-card", hiveDark.shadows.card],
  ["shadow-card-hover", hiveDark.shadows.cardHover],
  ["shadow-palette-hover", hiveDark.shadows.paletteHover],
  ["shadow-concurrency-hover", hiveDark.shadows.concurrencyHover],
  ["shadow-concurrency-add-hover", hiveDark.shadows.concurrencyAddHover],
  ["shadow-menu", hiveDark.shadows.menu],
  ["shadow-modal", hiveDark.shadows.modal],
  ["shadow-drag-ghost", hiveDark.shadows.dragGhost],
  ["shadow-toast", hiveDark.shadows.toast],
  ["shadow-toast-outer", hiveDark.shadows.toastOuter],
];

/**
 * Custom-property names that intentionally live in tokens.css but are NOT
 * theme-driven (not in any Theme TS object). Excluded from both the "must
 * match" check and the "no extras" check. Keep this list tight — anything
 * static like radius and font stack belongs here; everything else should be
 * promoted to the Theme schema.
 */
const STATIC_TOKENS = new Set([
  "radius-sm",
  "radius-md",
  "radius-lg",
  "font-inter",
]);

/**
 * Read every `--name: value;` declaration that appears inside either a
 * top-level `:root { … }` block or a Tailwind v4 `@theme { … }` block in
 * tokens.css, and return them as a single map. Tailwind v4 emits `@theme`
 * declarations into the compiled `:root`, so semantically they share the
 * same cascade; for drift-checking purposes we treat them as one source.
 *
 * Excludes declarations whose name is in `STATIC_TOKENS`.
 */
function loadTokensRoot(): Map<string, string> {
  const path = resolve(__dirname, "../../styles/tokens.css");
  const rawCss = readFileSync(path, "utf8");
  // Strip CSS comments first — comments may legitimately contain `}` (e.g.
  // documentation references like `shadows: { ... }`), which would otherwise
  // terminate the non-greedy block match below.
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");

  const declarations = new Map<string, string>();
  // Match `--name: value;` allowing the value to contain commas / parens / spaces.
  const declRegex = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;

  for (const blockRegex of [/:root\s*\{([\s\S]*?)\}/, /@theme\s*\{([\s\S]*?)\}/]) {
    const blockMatch = css.match(blockRegex);
    if (!blockMatch) continue;
    let match;
    declRegex.lastIndex = 0;
    while ((match = declRegex.exec(blockMatch[1])) !== null) {
      const name = match[1].trim();
      if (STATIC_TOKENS.has(name)) continue;
      // Skip --color-* re-exports — those are Tailwind utility aliases, not
      // theme sources. They reference :root vars via var() and don't carry
      // independent values worth drift-checking.
      if (name.startsWith("color-")) continue;
      declarations.set(name, match[2].trim());
    }
  }
  return declarations;
}

describe("tokens.css ↔ hive-dark.ts mirror", () => {
  const tokensRoot = loadTokensRoot();

  it.each(MIRROR_MAP)(
    "--%s in tokens.css :root matches the active theme value",
    (varName, expected) => {
      const actual = tokensRoot.get(varName);
      expect(actual, `--${varName} missing from tokens.css :root`).toBeDefined();
      expect(actual).toBe(expected);
    },
  );

  it("tokens.css :root has no extra vars beyond MIRROR_MAP", () => {
    const mapped = new Set(MIRROR_MAP.map(([name]) => name));
    const extras = [...tokensRoot.keys()].filter((name) => !mapped.has(name));
    expect(
      extras,
      `tokens.css :root has vars not in MIRROR_MAP — add them so drift is caught: ${extras.join(", ")}`,
    ).toEqual([]);
  });
});
