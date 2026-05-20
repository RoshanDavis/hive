import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

// ─── Types ───────────────────────────────────────────────────
interface Workspace {
  name: string;
  path: string;
  is_initialized: boolean;
}

interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}

interface DashboardProps {
  onOpenWorkspace: (ws: Workspace) => void;
}

// ─── Dashboard ───────────────────────────────────────────────
export default function Dashboard({ onOpenWorkspace }: DashboardProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activeNav, setActiveNav] = useState(0);

  // Toast helper
  const showToast = useCallback((message: string, type: "success" | "error") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  // Load workspaces on mount
  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    try {
      setLoading(true);
      const ws = await invoke<Workspace[]>("get_workspaces");
      setWorkspaces(ws);
    } catch (err) {
      showToast(`Failed to load workspaces: ${err}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // Open folder picker and add workspace
  const handleAddWorkspace = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select a workspace folder",
      });

      if (selected === null) return; // User cancelled

      const path = typeof selected === "string" ? selected : String(selected);
      const ws = await invoke<Workspace>("add_workspace", { path });
      setWorkspaces((prev) => [...prev, ws]);

      if (ws.is_initialized) {
        showToast(`Opened existing workspace: ${ws.name}`, "success");
      } else {
        showToast(`Created new workspace: ${ws.name}`, "success");
      }
    } catch (err) {
      showToast(`${err}`, "error");
    }
  };

  // Remove workspace from list
  const handleRemoveWorkspace = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("remove_workspace", { path });
      setWorkspaces((prev) => prev.filter((ws) => ws.path !== path));
      showToast("Workspace removed", "success");
    } catch (err) {
      showToast(`Failed to remove workspace: ${err}`, "error");
    }
  };

  // Filter workspaces by search
  const filteredWorkspaces = workspaces.filter(
    (ws) =>
      ws.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ws.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Truncate path for display
  const truncatePath = (path: string): string => {
    const maxLen = 30;
    if (path.length <= maxLen) return path;
    const parts = path.replace(/\\/g, "/").split("/");
    if (parts.length <= 3) return path;
    return parts[0] + "/.../" + parts.slice(-2).join("/");
  };

  // Nav items for sidebar
  const navItems = [
    { icon: "🔲", label: "Dashboard" },
    { icon: "📦", label: "Packages" },
    { icon: "⚙️", label: "Settings" },
  ];

  return (
    <div className="flex h-full w-full bg-primary text-text-main overflow-hidden">
      {/* ─── Sidebar ─── */}
      <nav className="w-[56px] flex flex-col items-center py-4 bg-sidebar border-r border-border-subtle z-10 shrink-0" id="sidebar">
        <div className="text-2xl mb-4 select-none" title="Hive">
          🐝
        </div>
        {navItems.map((item, i) => (
          <button
            key={i}
            className={`w-10 h-10 rounded-md flex items-center justify-center text-lg transition-colors duration-150 ${activeNav === i ? "text-accent bg-card shadow-[0_0_8px_rgba(212,230,0,0.15)]" : "text-text-secondary hover:text-text-main hover:bg-card"}`}
            onClick={() => setActiveNav(i)}
            title={item.label}
            id={`nav-${item.label.toLowerCase()}`}
          >
            {item.icon}
          </button>
        ))}
      </nav>

      {/* ─── Main Content ─── */}
      <main className="flex-1 flex flex-col relative">
        <div className="flex-1 flex flex-col p-8 overflow-y-auto">
          {/* Title */}
          <h1 className="text-3xl font-bold mb-8 text-center bg-clip-text text-transparent bg-gradient-to-r from-text-main to-text-secondary" id="dashboard-title">
            Hive
          </h1>

          {/* Search */}
          <div className="w-full max-w-2xl mx-auto mb-8">
            <div className="flex items-center bg-card rounded-md border border-border-subtle px-4 py-2 focus-within:border-accent-dim focus-within:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] transition-all">
              <span className="text-text-muted mr-3">🔍</span>
              <input
                className="flex-1 bg-transparent border-none outline-none text-text-main text-sm"
                id="workspace-search"
                type="text"
                placeholder="Search workspaces..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Loading */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full border-2 border-border-subtle border-t-accent animate-spin" />
            </div>
          ) : (
            <>
              {/* Workspace Grid */}
              {filteredWorkspaces.length > 0 || searchQuery === "" ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4 max-w-[1200px] w-full mx-auto" id="workspace-grid">
                  {filteredWorkspaces.map((ws) => (
                    <div
                      key={ws.path}
                      className="bg-card rounded-xl p-5 border border-border-card shadow-card flex flex-col cursor-pointer transition-all duration-250 hover:bg-card-hover hover:-translate-y-1 hover:shadow-card-hover hover:border-accent-dim relative group"
                      id={`workspace-${ws.name}`}
                      title={ws.path}
                      onClick={() => onOpenWorkspace(ws)}
                    >
                      <button
                        className="absolute top-3 right-3 text-text-muted hover:text-[#ff6b6b] hover:bg-[rgba(255,107,107,0.1)] w-6 h-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => handleRemoveWorkspace(ws.path, e)}
                        title="Remove workspace"
                      >
                        ✕
                      </button>
                      <span className="text-lg font-semibold mb-2 overflow-hidden text-ellipsis whitespace-nowrap">{ws.name}</span>
                      <span className="text-xs text-text-muted mb-4 overflow-hidden text-ellipsis whitespace-nowrap">{truncatePath(ws.path)}</span>
                      <span
                        className={`self-start text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${ws.is_initialized ? "text-accent bg-accent-glow" : "text-[#60a5fa] bg-[rgba(96,165,250,0.1)]"}`}
                      >
                        {ws.is_initialized ? "Initialized" : "New"}
                      </span>
                    </div>
                  ))}

                  {/* Add Button — always last in grid */}
                  <div
                    className="bg-transparent border-2 border-dashed border-border-card rounded-xl p-5 flex items-center justify-center cursor-pointer transition-all duration-250 hover:border-accent hover:bg-accent-glow hover:text-accent group min-h-[140px]"
                    id="add-workspace-btn"
                    onClick={handleAddWorkspace}
                    title="Add workspace"
                  >
                    <span className="text-4xl text-text-secondary group-hover:text-accent transition-colors">＋</span>
                  </div>
                </div>
              ) : (
                /* No results */
                <div className="flex-1 flex flex-col items-center justify-center text-text-muted">
                  <span className="text-4xl mb-4">🔍</span>
                  <span className="text-lg font-medium">
                    No workspaces match "{searchQuery}"
                  </span>
                </div>
              )}

              {/* Empty state when no workspaces at all */}
              {workspaces.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-text-muted">
                  <span className="text-4xl mb-4">🐝</span>
                  <span className="text-lg font-medium">No workspaces yet</span>
                  <span className="text-sm mt-2">
                    Click the + button above to add your first workspace
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* ─── Toasts ─── */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
          {toasts.map((toast) => (
            <div key={toast.id} className={`px-4 py-3 rounded-md text-sm font-medium shadow-[0_4px_12px_rgba(0,0,0,0.5)] flex items-center gap-2 animate-[slideIn_0.2s_ease-out] ${toast.type === "success" ? "bg-card border border-[#34d399] text-[#34d399]" : "bg-card border border-[#ff6b6b] text-[#ff6b6b]"}`}>
              {toast.type === "success" ? "✓ " : "✕ "}
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
