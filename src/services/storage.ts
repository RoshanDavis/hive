import type { Node, Edge } from "@xyflow/react";

// ─── Storage Type Interfaces ──────────────────────────────────
export interface ClipboardData {
  nodes: Node[];
  edges: Edge[];
  copiedWithData: boolean;
}

// ─── Centralized Type-Safe Storage client ──────────────────────
export const storage = {
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
