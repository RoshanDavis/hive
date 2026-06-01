import { useState } from "react";
import Dashboard from "@/components/Dashboard";
import WorkspaceEditor from "@/components/WorkspaceEditor";
import "@/nodes/plugins"; // Side-effect import: registers all built-in node plugins app-wide
import { CustomNodesProvider } from "@/contexts/CustomNodesContext";
import { BackgroundRunnersProvider } from "@/contexts/BackgroundRunnersContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import "./App.css";

// ─── Types ───────────────────────────────────────────────────
interface ActiveWorkspace {
  name: string;
  path: string;
  // Snapshot of the registry's background_execution flag at the moment the
  // workspace was opened. Threaded through to `getOrCreateSession` so the
  // session starts with the persisted value rather than the default-true
  // assumption + async correction (which left a small window where retention
  // decisions could use the wrong flag).
  backgroundExecution: boolean;
}

// ─── App (Router) ────────────────────────────────────────────
function App() {
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace | null>(null);

  return (
    <ThemeProvider>
      <BackgroundRunnersProvider>
        <CustomNodesProvider workspacePath={activeWorkspace?.path ?? null}>
          {activeWorkspace ? (
            <WorkspaceEditor
              workspaceName={activeWorkspace.name}
              workspacePath={activeWorkspace.path}
              backgroundExecution={activeWorkspace.backgroundExecution}
              onBack={() => setActiveWorkspace(null)}
            />
          ) : (
            <Dashboard
              onOpenWorkspace={(ws) =>
                setActiveWorkspace({
                  name: ws.name,
                  path: ws.path,
                  backgroundExecution: ws.background_execution,
                })
              }
            />
          )}
        </CustomNodesProvider>
      </BackgroundRunnersProvider>
    </ThemeProvider>
  );
}

export default App;
