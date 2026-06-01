/**
 * Theme runtime — registry, active-theme state, and the public accessors that
 * non-React code (engine helpers, React Flow's MiniMap/edge callbacks) reaches
 * for. React components prefer the `useTheme()` hook so they re-render on
 * theme switch; the function exports here are for code outside React's render
 * graph that just needs "what's the success color right now."
 *
 * Adding a new theme:
 *   1. Add a file under `src/theme/themes/` exporting a `Theme` object.
 *   2. Register it in `builtInThemes` below.
 *   3. (When the UI switcher lands) surface its `id`/`name` to the user.
 *
 * Future user-defined themes will register through the same `registerTheme`
 * surface from a context that loads them off disk — the runtime stays
 * theme-source-agnostic.
 */

import type { Theme } from "./types";
import { hiveDark } from "./themes/hive-dark";

export type { Theme } from "./types";
export { applyTheme } from "./applyTheme";

const themeRegistry = new Map<string, Theme>();
themeRegistry.set(hiveDark.id, hiveDark);

let activeTheme: Theme = hiveDark;

/** Default theme used when no preference exists. */
export const DEFAULT_THEME_ID = hiveDark.id;

/** The currently-active theme. Always defined; defaults to `hive-dark`. */
export function getActiveTheme(): Theme {
  return activeTheme;
}

/** Replace the active theme. The ThemeContext owns calling `applyTheme()`
 * after this so subscribers re-render in step with the DOM update. */
export function setActiveTheme(theme: Theme): void {
  activeTheme = theme;
}

/** Look up a theme by id (built-in or user-registered). */
export function getTheme(id: string): Theme | undefined {
  return themeRegistry.get(id);
}

/** Every registered theme (built-in + dynamically registered). */
export function listThemes(): Theme[] {
  return Array.from(themeRegistry.values());
}

/** Register a theme at runtime (user-defined / imported). Idempotent on `id`. */
export function registerTheme(theme: Theme): void {
  themeRegistry.set(theme.id, theme);
}

/** Built-in themes shipped with the app. Kept exported so the eventual
 * switcher can render them in a stable order. */
export const builtInThemes: readonly Theme[] = [hiveDark];
