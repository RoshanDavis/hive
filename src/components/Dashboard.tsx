import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ToastContainer } from "@/components/Toast";
import { api, type Workspace } from "@/services/api";
import { useToast } from "@/hooks/useToast";
import { SettingsModal } from "@/components/settings";
import NodesPage from "@/components/NodesPage";
import {
  useBackgroundRunners,
  useHasActiveRuns,
  useHasErrorNodes,
  useHasWaitingNodes,
} from "@/contexts/BackgroundRunnersContext";
import { getStatusColor } from "@/theme/colors";

interface DashboardProps {
  onOpenWorkspace: (ws: Workspace) => void;
}

interface WorkspaceCardProps {
  ws: Workspace;
  truncatedPath: string;
  onOpen: () => void;
  onRemove: (e: React.MouseEvent) => void;
  onToggleBackground: (e: React.MouseEvent) => void;
}

function WorkspaceCard({
  ws,
  truncatedPath,
  onOpen,
  onRemove,
  onToggleBackground,
}: WorkspaceCardProps) {
  const isActive = useHasActiveRuns(ws.path);
  const hasError = useHasErrorNodes(ws.path);
  const hasWaiting = useHasWaitingNodes(ws.path);
  // Priority (highest → lowest): error → waiting → executing → idle.
  // Error and waiting are sticky across app restarts (they come from the
  // per-space rollup on disk). Executing is in-memory only — it never
  // persists, because `load_space` collapses any stale `executing` to error.
  const statusDot: "error" | "waiting" | "active" | null = hasError
    ? "error"
    : hasWaiting
    ? "waiting"
    : isActive
    ? "active"
    : null;
  return (
    <div
      className="bg-card rounded-xl p-5 border border-border-card shadow-card flex flex-col cursor-pointer transition-all duration-250 hover:bg-card-hover hover:-translate-y-1 hover:shadow-card-hover hover:border-border-card relative group"
      id={`workspace-${ws.name}`}
      title={ws.path}
      onClick={onOpen}
    >
      {statusDot === "error" && (
        <span
          className="absolute top-3 left-3 w-2 h-2 rounded-full"
          style={{ backgroundColor: getStatusColor("error"), boxShadow: `0 0 6px ${getStatusColor("error")}` }}
          title="A space in this workspace has an errored node — open to investigate"
        />
      )}
      {statusDot === "waiting" && (
        <span
          className="absolute top-3 left-3 w-2 h-2 rounded-full"
          style={{ backgroundColor: getStatusColor("waiting"), boxShadow: `0 0 6px ${getStatusColor("waiting")}` }}
          title="A workflow is paused waiting for input — open to respond"
        />
      )}
      {statusDot === "active" && (
        <span
          className="absolute top-3 left-3 w-2 h-2 rounded-full animate-pulse"
          style={{ backgroundColor: getStatusColor("executing"), boxShadow: `0 0 6px ${getStatusColor("executing")}` }}
          title="Workflow running in background"
        />
      )}
      <button
        className="absolute top-3 right-3 text-text-muted hover:text-danger hover:bg-danger/10 w-6 h-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={onRemove}
        title="Remove workspace"
      >
        ✕
      </button>
      <span className="text-base sm:text-lg font-semibold mb-2 overflow-hidden text-ellipsis whitespace-nowrap">{ws.name}</span>
      <span className="text-xs text-text-muted mb-4 overflow-hidden text-ellipsis whitespace-nowrap">{truncatedPath}</span>
      <button
        className="self-start flex items-center gap-2 cursor-pointer group/toggle"
        onClick={onToggleBackground}
        title={
          ws.background_execution
            ? "Workspace is online — workflows run in background. Click to take offline."
            : "Workspace is offline — workflows only run while open. Click to bring online."
        }
      >
        <span
          className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${
            ws.background_execution ? "text-success" : "text-text-muted"
          }`}
        >
          {ws.background_execution ? "Online" : "Offline"}
        </span>
        <span
          className={`relative w-8 h-4 rounded-full transition-colors duration-200 ${
            ws.background_execution
              ? "bg-success shadow-[0_0_6px_rgba(34,197,94,0.4)]"
              : "bg-card group-hover/toggle:bg-card-hover"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-toggle-knob transition-transform duration-200 ${
              ws.background_execution ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </span>
      </button>
    </div>
  );
}

export default function Dashboard({ onOpenWorkspace }: DashboardProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeNav, setActiveNav] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const { toasts, showToast } = useToast(3000);
  const { refreshDiskRollups, setBackgroundExecution: setSessionBackground } = useBackgroundRunners();

  useEffect(() => {
    loadWorkspaces();
  }, []);

  // Pull the on-disk per-space rollups whenever the workspace list changes
  // (initial mount + add/remove). One batched Tauri call reads each
  // workspace's `.hive/config.json` — no space files touched. Live in-flight
  // state still comes from the in-memory session overlay; this populates
  // the steady-state cross-space view used for idle workspaces.
  useEffect(() => {
    if (workspaces.length === 0) return;
    void refreshDiskRollups(workspaces.map((w) => w.path));
  }, [workspaces, refreshDiskRollups]);

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

  const handleAddWorkspace = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select a workspace folder",
      });

      if (selected === null) return;

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

  const handleToggleBackground = async (ws: Workspace, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !ws.background_execution;
    // Optimistic update; revert on failure so the icon stays consistent with disk.
    setWorkspaces((prev) =>
      prev.map((w) => (w.path === ws.path ? { ...w, background_execution: next } : w))
    );
    // Also push to any in-memory RunnerSession (retained background session
    // for a workspace not currently open in the editor) so its post-run
    // retention decision honors the new toggle without waiting for restart.
    // No-op for workspaces with no live session.
    setSessionBackground(ws.path, next);
    try {
      await api.setWorkspaceBackgroundExecution(ws.path, next);
      showToast(
        `${ws.name}: background execution ${next ? "enabled" : "disabled"}`,
        "success"
      );
    } catch (err) {
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.path === ws.path ? { ...w, background_execution: !next } : w
        )
      );
      setSessionBackground(ws.path, !next);
      showToast(`Failed to update background execution: ${err}`, "error");
    }
  };

  const filteredWorkspaces = workspaces.filter(
    (ws) =>
      ws.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ws.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const truncatePath = (path: string): string => {
    const maxLen = 30;
    if (path.length <= maxLen) return path;
    const parts = path.replace(/\\/g, "/").split("/");
    if (parts.length <= 3) return path;
    return parts[0] + "/.../" + parts.slice(-2).join("/");
  };

  const navItems = [
    { icon: "🔲", label: "Dashboard" },
    { icon: "🧩", label: "Nodes" },
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

        <div className="grow" />

        {/* Settings button */}
        <button
          className="w-10 h-10 rounded-md flex items-center justify-center cursor-pointer transition-all border border-border-subtle bg-transparent text-lg text-text-secondary hover:text-text-main hover:border-border-card hover:bg-card select-none"
          onClick={() => setIsSettingsOpen(true)}
          title="Settings"
          id="dashboard-settings-btn"
        >
          ⚙️
        </button>
      </nav>

      {/* ─── Main Content ─── */}
      <main className="flex-1 flex flex-col relative w-full overflow-hidden">
        {activeNav === 1 ? (
          <NodesPage showToast={showToast} />
        ) : (
        <div className="flex-1 flex flex-col p-4 sm:p-6 md:p-8 overflow-y-auto w-full">
          {/* Title / Hero */}
          <div className="text-center mb-10 mt-4 flex flex-col items-center select-none">
            <span className="text-5xl mb-4 hover:scale-110 transition-transform duration-300 cursor-default filter drop-shadow-[0_0_12px_rgba(212,230,0,0.35)]">
              🐝
            </span>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-accent via-text-main to-text-secondary" id="dashboard-title">
              Hive
            </h1>
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
                    <WorkspaceCard
                      key={ws.path}
                      ws={ws}
                      truncatedPath={truncatePath(ws.path)}
                      onOpen={() => onOpenWorkspace(ws)}
                      onRemove={(e) => handleRemoveWorkspace(ws.path, e)}
                      onToggleBackground={(e) => handleToggleBackground(ws, e)}
                    />
                  ))}

                  {/* Add Button — always last in grid */}
                  <div
                    className="bg-transparent border-2 border-dashed border-border-card rounded-xl p-5 flex flex-col items-center justify-center cursor-pointer transition-all duration-250 hover:border-border-card hover:bg-card-hover hover:text-text-main group min-h-35"
                    id="add-workspace-btn"
                    onClick={handleAddWorkspace}
                    title="Add workspace"
                  >
                    <span className="text-3xl text-text-secondary group-hover:text-text-main transition-colors mb-1">＋</span>
                    <span className="text-xs text-text-secondary group-hover:text-text-main font-medium transition-colors">Add Workspace</span>
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
        )}
      </main>

      {/* ─── Settings Modal ─── */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        showToast={showToast}
      />

      {/* ─── Toasts ─── */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}
