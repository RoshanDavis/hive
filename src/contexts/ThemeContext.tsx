import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyTheme,
  DEFAULT_THEME_ID,
  getTheme,
  listThemes,
  setActiveTheme as setActiveThemeModule,
  type Theme,
} from "@/theme";

const LOCAL_STORAGE_KEY = "hive-active-theme";

interface ThemeContextValue {
  /** The currently-active theme. */
  theme: Theme;
  /** Replace the active theme by id; no-op if id is unknown. Persists the
   * choice to localStorage so it survives reloads. */
  setThemeById: (id: string) => void;
  /** Every registered theme (built-in + dynamically registered). Refreshed
   * on demand via `refreshThemes`. */
  themes: Theme[];
  /** Re-pull the registry — used after `registerTheme()` adds user themes. */
  refreshThemes: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Resolve the initial theme: persisted choice if valid, else the default.
 * Reads localStorage synchronously during render so the first paint sees
 * the right theme and we never flash dark before switching to light.
 */
function resolveInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return getTheme(DEFAULT_THEME_ID)!;
  }
  try {
    const saved = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      const t = getTheme(saved);
      if (t) return t;
    }
  } catch {
    /* localStorage blocked (private mode, embedded, etc.) — fall through. */
  }
  return getTheme(DEFAULT_THEME_ID)!;
}

/**
 * Owns the active theme. Mount this at the root of the React tree, before
 * any other provider that might need theme colors. Applies the resolved
 * theme synchronously in render via a `useState` initializer + `useEffect`
 * pair: the initializer reads the persisted choice (synchronous, no FOUC),
 * and `applyTheme()` runs in the effect to write CSS variables for it.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme);
  const [registryVersion, setRegistryVersion] = useState(0);

  // Keep the module-level mirror in sync so non-React consumers (engine
  // helpers, React Flow callbacks) see the current theme.
  useEffect(() => {
    setActiveThemeModule(theme);
    applyTheme(theme);
  }, [theme]);

  const setThemeById = useCallback((id: string) => {
    const next = getTheme(id);
    if (!next) return;
    setTheme(next);
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, id);
    } catch {
      /* localStorage blocked — ignore; the in-memory switch still works. */
    }
  }, []);

  const refreshThemes = useCallback(() => {
    setRegistryVersion((v) => v + 1);
  }, []);

  const themes = useMemo(
    () => listThemes(),
    // Re-read the registry whenever refreshThemes was called.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registryVersion]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setThemeById, themes, refreshThemes }),
    [theme, setThemeById, themes, refreshThemes]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Subscribe to the active theme. Components that read theme colors in
 * render should use this so they update on theme switch. Code outside React
 * (engine, services) should use `getActiveTheme()` from `@/theme` instead. */
export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx.theme;
}

/** The full context, for the future theme switcher UI. */
export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeContext must be used inside <ThemeProvider>");
  return ctx;
}
