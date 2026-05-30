import { useState } from "react";
import Dashboard from "@/components/Dashboard";
import WorkspaceEditor from "@/components/WorkspaceEditor";
import "@/nodes/plugins"; // Side-effect import: registers all built-in node plugins app-wide
import { CustomNodesProvider } from "@/contexts/CustomNodesContext";
import { BackgroundRunnersProvider } from "@/contexts/BackgroundRunnersContext";
import "./App.css";

// ─── Types ───────────────────────────────────────────────────
interface ActiveWorkspace {
  name: string;
  path: string;
}

// ─── App (Router) ────────────────────────────────────────────
function App() {
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace | null>(null);

  return (
    <BackgroundRunnersProvider>
      <CustomNodesProvider workspacePath={activeWorkspace?.path ?? null}>
        {activeWorkspace ? (
          <WorkspaceEditor
            workspaceName={activeWorkspace.name}
            workspacePath={activeWorkspace.path}
            onBack={() => setActiveWorkspace(null)}
          />
        ) : (
          <Dashboard
            onOpenWorkspace={(ws) => setActiveWorkspace({ name: ws.name, path: ws.path })}
          />
        )}
      </CustomNodesProvider>
    </BackgroundRunnersProvider>
  );
}

export default App;
