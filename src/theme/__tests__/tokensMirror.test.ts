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
];

/**
 * Extract the `:root { … }` block from tokens.css and parse its `--foo: value;`
 * declarations into a Map. We intentionally only read the first `:root` block
 * (the one at the top of the file). The `@theme` block below it is Tailwind's
 * concern and not part of the mirror contract.
 */
function loadTokensRoot(): Map<string, string> {
  const path = resolve(__dirname, "../../styles/tokens.css");
  const css = readFileSync(path, "utf8");

  const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!rootMatch) {
    throw new Error("Could not find :root block in tokens.css");
  }

  const declarations = new Map<string, string>();
  // Match `--name: value;` allowing the value to contain commas / parens / spaces.
  const declRegex = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let match;
  while ((match = declRegex.exec(rootMatch[1])) !== null) {
    declarations.set(match[1].trim(), match[2].trim());
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
