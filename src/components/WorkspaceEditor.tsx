import { useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type OnConnect,
  type Node,
  type Edge,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import SpacesSidebar from "./SpacesSidebar";
import InspectorPanel from "./InspectorPanel";

interface WorkspaceEditorProps {
  workspaceName: string;
  workspacePath: string;
  onBack: () => void;
}

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

export default function WorkspaceEditor({
  workspaceName,
  workspacePath: _workspacePath,
  onBack,
}: WorkspaceEditorProps) {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect: OnConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  return (
    <div className="editor-layout" id="workspace-editor">
      {/* Left — Spaces Sidebar */}
      <SpacesSidebar workspaceName={workspaceName} onBack={onBack} />

      {/* Center — React Flow Canvas */}
      <div className="editor-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.2}
            color="#333333"
          />
          <Controls
            position="bottom-left"
            showInteractive={false}
          />
          <MiniMap
            position="bottom-right"
            nodeColor="#d4e600"
            maskColor="rgba(0, 0, 0, 0.7)"
            style={{
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              borderRadius: "8px",
            }}
          />
        </ReactFlow>

        {/* Empty canvas overlay hint */}
        {nodes.length === 0 && (
          <div className="canvas-empty-hint">
            <span className="canvas-hint-icon">🐝</span>
            <span className="canvas-hint-text">
              Your canvas is empty
            </span>
            <span className="canvas-hint-sub">
              Add nodes from the panel on the right to get started
            </span>
          </div>
        )}
      </div>

      {/* Right — Inspector Panel */}
      <InspectorPanel />
    </div>
  );
}
