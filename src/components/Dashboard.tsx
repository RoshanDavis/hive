import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ToastContainer } from "@/components/Toast";
import { api, type Workspace } from "@/services/api";
import { useToast } from "@/hooks/useToast";

interface DashboardProps {
  onOpenWorkspace: (ws: Workspace) => void;
}

// ─── Dashboard ───────────────────────────────────────────────
export default function Dashboard({ onOpenWorkspace }: DashboardProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeNav, setActiveNav] = useState(0);

  // Unified custom hook toast helper
  const { toasts, showToast } = useToast(3000);

  // Load workspaces on mount
  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    try {
      setLoading(true);
      const ws = await api.getWorkspaces();
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
      const ws = await api.addWorkspace(path);
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
      await api.removeWorkspace(path);
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

  // Nav items for sidebar (removed unimplemented Packages and Settings icons)
  const navItems = [
    { icon: "🔲", label: "Dashboard" },
  ];

  return (
    <div className="flex h-full w-full bg-primary text-text-main overflow-hidden">
      {/* ─── Sidebar ─── */}
      <nav className="w-14 flex flex-col items-center py-4 bg-sidebar border-r border-border-subtle z-10 shrink-0 select-none" id="sidebar">
        <div className="text-2xl mb-4 select-none filter drop-shadow-[0_0_8px_rgba(212,230,0,0.2)]" title="Hive">
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
      <main className="flex-1 flex flex-col relative w-full overflow-hidden">
        <div className="flex-1 flex flex-col p-4 sm:p-6 md:p-8 overflow-y-auto w-full">
          {/* Title / Hero */}
          <div className="text-center mb-10 mt-4 flex flex-col items-center select-none">
            <span className="text-5xl mb-4 hover:scale-110 transition-transform duration-300 cursor-default filter drop-shadow-[0_0_12px_rgba(212,230,0,0.35)]">
              🐝
            </span>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-accent via-text-main to-text-secondary" id="dashboard-title">
              Hive
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary mt-2 max-w-md mx-auto leading-relaxed">
              Design, orchestrate, and automate agentic LLM workflows locally
            </p>
          </div>

          {/* Search */}
          <div className="w-full max-w-xl mx-auto mb-10 px-1">
            <div className="flex items-center bg-card/60 backdrop-blur-md rounded-xl border border-border-subtle px-4 py-2.5 focus-within:border-accent-dim focus-within:shadow-[0_0_0_2px_rgba(212,230,0,0.15)] transition-all duration-300">
              <span className="text-text-secondary text-base mr-3 select-none">🔍</span>
              <input
                className="flex-1 bg-transparent border-none outline-none text-text-main text-sm placeholder:text-text-muted"
                id="workspace-search"
                type="text"
                placeholder="Search workspaces by name or path..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="text-text-secondary hover:text-text-main text-xs px-1 select-none cursor-pointer"
                >
                  ✕
                </button>
              )}
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
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 max-w-300 w-full mx-auto px-1" id="workspace-grid">
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
                      <span className="text-base sm:text-lg font-semibold mb-2 overflow-hidden text-ellipsis whitespace-nowrap">{ws.name}</span>
                      <span className="text-xs text-text-muted mb-4 overflow-hidden text-ellipsis whitespace-nowrap">{truncatePath(ws.path)}</span>
                      <span
                        className={`self-start text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${ws.is_initialized ? "text-accent bg-accent-glow" : "text-node-notify bg-[rgba(96,165,250,0.1)]"}`}
                      >
                        {ws.is_initialized ? "Initialized" : "New"}
                      </span>
                    </div>
                  ))}

                  {/* Add Button — always last in grid */}
                  <div
                    className="bg-transparent border-2 border-dashed border-border-card rounded-xl p-5 flex flex-col items-center justify-center cursor-pointer transition-all duration-250 hover:border-accent hover:bg-accent-glow hover:text-accent group min-h-35"
                    id="add-workspace-btn"
                    onClick={handleAddWorkspace}
                    title="Add workspace"
                  >
                    <span className="text-3xl text-text-secondary group-hover:text-accent transition-colors mb-1">＋</span>
                    <span className="text-xs text-text-secondary group-hover:text-accent font-medium transition-colors">Add Workspace</span>
                  </div>
                </div>
              ) : (
                /* No results */
                <div className="flex-1 flex flex-col items-center justify-center text-text-muted py-12">
                  <span className="text-4xl mb-4 select-none">🔍</span>
                  <span className="text-base font-medium">
                    No workspaces match "{searchQuery}"
                  </span>
                </div>
              )}

              {/* Empty state when no workspaces at all */}
              {workspaces.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-text-muted py-12">
                  <span className="text-4xl mb-4 select-none">🐝</span>
                  <span className="text-base font-medium">No workspaces yet</span>
                  <span className="text-sm mt-1">
                    Click the + button above to add your first workspace
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* ─── Toasts ─── */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}
