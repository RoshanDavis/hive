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

export type ConcurrencySettings = Record<string, ConcurrencyConfig>;

// ─── Centralized Type-Safe Storage client ──────────────────────
export const storage = {
  // Node Concurrency settings
  getConcurrencySettings(): ConcurrencySettings {
    const raw = localStorage.getItem("hive-concurrency-settings");
    const defaultSettings: ConcurrencySettings = {
      ollama: { enabled: true, limit: 1 },
      notify: { enabled: false, limit: 2 },
      chat: { enabled: false, limit: 2 },
      output: { enabled: false, limit: 2 },
      trigger: { enabled: false, limit: 2 },
      jsonStorage: { enabled: false, limit: 2 },
    };

    if (!raw) return defaultSettings;
    try {
      const parsed = JSON.parse(raw);
      return { ...defaultSettings, ...parsed };
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
