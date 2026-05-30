import type { Node, Edge } from "@xyflow/react";

// ─── Storage Type Interfaces ──────────────────────────────────
export interface ClipboardData {
  nodes: Node[];
  edges: Edge[];
  copiedWithData: boolean;
}

export interface ConcurrencyConfig {
  enabled: boolean;
  limit: number;
}

export interface ConcurrencySettings {
  local: ConcurrencyConfig;    // For local models (Ollama, LM Studio, etc.)
  cloud: ConcurrencyConfig;    // For cloud APIs (OpenAI, Anthropic, Google, etc.)
  general: ConcurrencyConfig;  // For other lightweight tasks (e.g. notifications)
  localPatterns: string[];     // Glob wildcard patterns, e.g. ["*localhost*", "*127.0.0.1*", "*[::1]*"]
}

// ─── Centralized Type-Safe Storage client ──────────────────────
export const storage = {
  // Node Concurrency settings
  getConcurrencySettings(): ConcurrencySettings {
    const raw = localStorage.getItem("hive-concurrency-settings");
    const defaultSettings: ConcurrencySettings = {
      local: { enabled: true, limit: 1 },
      cloud: { enabled: false, limit: 10 },
      general: { enabled: false, limit: 2 },
      localPatterns: ["*localhost*", "*127.0.0.1*", "*[::1]*"]
    };

    if (!raw) return defaultSettings;
    try {
      const parsed = JSON.parse(raw);
      return {
        local: parsed.local ?? defaultSettings.local,
        cloud: parsed.cloud ?? defaultSettings.cloud,
        general: parsed.general ?? defaultSettings.general,
        localPatterns: Array.isArray(parsed.localPatterns)
          ? parsed.localPatterns
          : defaultSettings.localPatterns,
      };
    } catch {
      return defaultSettings;
    }
  },

  setConcurrencySettings(settings: ConcurrencySettings): void {
    localStorage.setItem("hive-concurrency-settings", JSON.stringify(settings));
  },
  // Inspector Width settings
  getInspectorWidth(fallback = 320): number {
    const saved = localStorage.getItem("hive-inspector-width");
    return saved ? parseInt(saved, 10) : fallback;
  },

  setInspectorWidth(width: number): void {
    localStorage.setItem("hive-inspector-width", String(width));
  },

  // Spaces Sidebar Width settings
  getSidebarWidth(fallback = 56): number {
    const saved = localStorage.getItem("hive-sidebar-width");
    return saved ? parseInt(saved, 10) : fallback;
  },

  setSidebarWidth(width: number): void {
    localStorage.setItem("hive-sidebar-width", String(width));
  },

  // Workspace Clipboard for Cut/Copy/Paste
  getClipboard(): ClipboardData | null {
    const raw = localStorage.getItem("hive-clipboard");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ClipboardData;
    } catch {
      return null;
    }
  },

  setClipboard(data: ClipboardData): void {
    localStorage.setItem("hive-clipboard", JSON.stringify(data));
  },

  hasClipboard(): boolean {
    return !!localStorage.getItem("hive-clipboard");
  },
};
