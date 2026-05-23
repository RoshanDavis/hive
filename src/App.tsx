import { useState } from "react";
import Dashboard from "@/components/Dashboard";
import WorkspaceEditor from "@/components/WorkspaceEditor";
import "./App.css";

// ─── Types ───────────────────────────────────────────────────
interface ActiveWorkspace {
  name: string;
  path: string;
}

// ─── App (Router) ────────────────────────────────────────────
function App() {
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace | null>(null);

  if (activeWorkspace) {
    return (
      <WorkspaceEditor
        workspaceName={activeWorkspace.name}
        workspacePath={activeWorkspace.path}
        onBack={() => setActiveWorkspace(null)}
      />
    );
  }

  return (
    <Dashboard
      onOpenWorkspace={(ws) => setActiveWorkspace({ name: ws.name, path: ws.path })}
    />
  );
}

export default App;
