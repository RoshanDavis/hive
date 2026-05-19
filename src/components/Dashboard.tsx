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
    <div className="app-layout">
      {/* ─── Sidebar ─── */}
      <nav className="sidebar" id="sidebar">
        <div className="sidebar-logo" title="Hive">
          🐝
        </div>
        {navItems.map((item, i) => (
          <button
            key={i}
            className={`sidebar-btn ${activeNav === i ? "active" : ""}`}
            onClick={() => setActiveNav(i)}
            title={item.label}
            id={`nav-${item.label.toLowerCase()}`}
          >
            {item.icon}
          </button>
        ))}
      </nav>

      {/* ─── Main Content ─── */}
      <main className="main-content">
        <div className="dashboard">
          {/* Title */}
          <h1 className="dashboard-title" id="dashboard-title">
            Hive
          </h1>

          {/* Search */}
          <div className="search-container">
            <div className="search-bar">
              <span className="search-icon">🔍</span>
              <input
                className="search-input"
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
            <div className="loading-container">
              <div className="spinner" />
            </div>
          ) : (
            <>
              {/* Workspace Grid */}
              {filteredWorkspaces.length > 0 || searchQuery === "" ? (
                <div className="workspace-grid" id="workspace-grid">
                  {filteredWorkspaces.map((ws) => (
                    <div
                      key={ws.path}
                      className="workspace-card"
                      id={`workspace-${ws.name}`}
                      title={ws.path}
                      onClick={() => onOpenWorkspace(ws)}
                    >
                      <button
                        className="card-remove"
                        onClick={(e) => handleRemoveWorkspace(ws.path, e)}
                        title="Remove workspace"
                      >
                        ✕
                      </button>
                      <span className="card-name">{ws.name}</span>
                      <span className="card-path">{truncatePath(ws.path)}</span>
                      <span
                        className={`card-status ${ws.is_initialized ? "online" : "new"}`}
                      >
                        {ws.is_initialized ? "Initialized" : "New"}
                      </span>
                    </div>
                  ))}

                  {/* Add Button — always last in grid */}
                  <div
                    className="add-card"
                    id="add-workspace-btn"
                    onClick={handleAddWorkspace}
                    title="Add workspace"
                  >
                    <span className="add-icon">＋</span>
                  </div>
                </div>
              ) : (
                /* No results */
                <div className="empty-state">
                  <span className="empty-icon">🔍</span>
                  <span className="empty-text">
                    No workspaces match "{searchQuery}"
                  </span>
                </div>
              )}

              {/* Empty state when no workspaces at all */}
              {workspaces.length === 0 && (
                <div className="empty-state">
                  <span className="empty-icon">🐝</span>
                  <span className="empty-text">No workspaces yet</span>
                  <span className="empty-hint">
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
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast ${toast.type}`}>
              {toast.type === "success" ? "✓ " : "✕ "}
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
