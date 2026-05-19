import { useState } from "react";

export default function InspectorPanel() {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="inspector-panel" id="inspector-panel">
      {/* Header */}
      <div className="inspector-header">
        <h2 className="inspector-title">Nodes</h2>
      </div>

      {/* Search */}
      <div className="inspector-search">
        <span className="inspector-search-icon">🔍</span>
        <input
          className="inspector-search-input"
          id="node-search"
          type="text"
          placeholder="Search nodes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Node list placeholder */}
      <div className="inspector-content">
        <div className="inspector-empty">
          <span className="inspector-empty-icon">📦</span>
          <span className="inspector-empty-text">Available nodes will appear here</span>
          <span className="inspector-empty-hint">
            Drag and drop nodes onto the canvas to build your flow
          </span>
        </div>
      </div>
    </div>
  );
}
