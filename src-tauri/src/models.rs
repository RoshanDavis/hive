use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}

// ─── App-level workspace registry ────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub name: String,
    pub path: String,
    pub is_initialized: bool,
    /// When true, workflows in this workspace keep running after the user
    /// navigates back to the Dashboard. When false, they only run while the
    /// workspace is open. Defaults to true so existing registries upgrade
    /// silently to the new behavior.
    #[serde(default = "default_true")]
    pub background_execution: bool,
}

// ─── Workspace config (lives at .hive/config.json) ──────────

/// Coarse per-space status rollup. Persisted on `SpaceEntry.status` so the
/// Dashboard can show a workspace-level dot without loading every space.
/// `Error` always wins over `Waiting`; `executing` is never persisted (it's
/// in-memory only — `load_space` sweeps stale `executing` → `error`).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpaceRollup {
    Error,
    Waiting,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaceEntry {
    pub id: String,
    pub label: String,
    pub order: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<SpaceRollup>,
}

/// Per-workspace status rollup returned by `get_workspace_status_rollups`.
/// Aggregates across every space in the workspace's `.hive/config.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceStatusRollup {
    pub path: String,
    pub has_error: bool,
    pub has_waiting: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceConfig {
    pub version: u32,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub spaces: Vec<SpaceEntry>,
    pub active_space: String,
}

// ─── Node defaults (global at app_data_dir, per-workspace at .hive) ─────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub name: String,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeDefaultsConfig {
    pub version: u32,
    /// Map of plugin type → partial node.data overrides.
    #[serde(default)]
    pub defaults: serde_json::Map<String, serde_json::Value>,
    /// Map of provider (lowercased) → list of user-added model entries.
    #[serde(default)]
    pub models: std::collections::HashMap<String, Vec<ModelEntry>>,
}

impl Default for NodeDefaultsConfig {
    fn default() -> Self {
        NodeDefaultsConfig {
            version: 1,
            defaults: serde_json::Map::new(),
            models: std::collections::HashMap::new(),
        }
    }
}

// ─── Tools registry (global at app_data_dir, per-workspace at .hive) ─────────
// User-defined native tools / MCP servers / skills the Agent's Tools slot can
// reference. Runtime invocation is deferred; this is selection metadata only.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDef {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsConfig {
    pub version: u32,
    #[serde(default)]
    pub native: Vec<ToolDef>,
    #[serde(default)]
    pub mcp: Vec<ToolDef>,
    #[serde(default)]
    pub skills: Vec<ToolDef>,
}

impl Default for ToolsConfig {
    fn default() -> Self {
        ToolsConfig {
            version: 1,
            native: Vec::new(),
            mcp: Vec::new(),
            skills: Vec::new(),
        }
    }
}

// ─── Custom nodes (global at app_data_dir, per-workspace at .hive) ───────────
// Folder-per-node: <base>/custom-nodes/<id>/node.json. The common fields are typed;
// kind-specific fields (baseType/presetData, and future script fields) round-trip
// through `extra` so the Rust side stays agnostic to the discriminated union.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomNodeDefinition {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub icon: String,
    pub category: String,
    pub version: u32,
    /// Older on-disk node.json files may still carry a `color` string written
    /// before the renderer started deriving color from category. We accept and
    /// drop it on serialize so promote/transplant survives those files.
    #[serde(default, skip_serializing)]
    pub color: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

// ─── Space data (lives at .hive/spaces/space_<id>.json) ─────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub position: Position,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_handle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_handle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaceData {
    pub id: String,
    pub label: String,
    pub nodes: Vec<FlowNode>,
    pub edges: Vec<FlowEdge>,
    pub viewport: Viewport,
}

// ─── Ollama Chat ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct OllamaOptions {
    pub temperature: f64,
    pub num_predict: u32,
}

#[derive(Serialize)]
pub struct OllamaRequest {
    pub model: String,
    pub messages: Vec<OllamaMessage>,
    pub stream: bool,
    pub options: OllamaOptions,
}

#[derive(Deserialize)]
pub struct OllamaResponse {
    pub message: Option<OllamaMessage>,
}
