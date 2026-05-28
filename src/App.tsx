import { useState } from "react";
import Dashboard from "@/components/Dashboard";
import WorkspaceEditor from "@/components/WorkspaceEditor";
import "@/nodes/plugins"; // Side-effect import: registers all built-in node plugins app-wide
import { CustomNodesProvider } from "@/contexts/CustomNodesContext";
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
  );
}

export default App;
