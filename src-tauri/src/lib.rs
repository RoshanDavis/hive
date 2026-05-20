use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

// ─── App-level workspace registry ────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub name: String,
    pub path: String,
    pub is_initialized: bool,
}

fn get_workspaces_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&app_data).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(app_data.join("workspaces.json"))
}

fn read_workspaces(app: &tauri::AppHandle) -> Result<Vec<Workspace>, String> {
    let file = get_workspaces_file(app)?;
    if !file.exists() {
        return Ok(vec![]);
    }
    let data = fs::read_to_string(&file).map_err(|e| format!("Failed to read workspaces: {}", e))?;
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse workspaces: {}", e))
}

fn write_workspaces(app: &tauri::AppHandle, workspaces: &[Workspace]) -> Result<(), String> {
    let file = get_workspaces_file(app)?;
    let data = serde_json::to_string_pretty(workspaces)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(&file, data).map_err(|e| format!("Failed to write workspaces: {}", e))?;
    Ok(())
}

#[tauri::command]
fn get_workspaces(app: tauri::AppHandle) -> Result<Vec<Workspace>, String> {
    let mut workspaces = read_workspaces(&app)?;
    for ws in workspaces.iter_mut() {
        let hive_dir = PathBuf::from(&ws.path).join(".hive");
        ws.is_initialized = hive_dir.exists() && hive_dir.is_dir();
    }
    write_workspaces(&app, &workspaces)?;
    Ok(workspaces)
}

#[tauri::command]
fn remove_workspace(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let mut workspaces = read_workspaces(&app)?;
    workspaces.retain(|ws| ws.path != path);
    write_workspaces(&app, &workspaces)?;
    Ok(())
}

// ─── .hive folder structure ──────────────────────────────────
//
//  .hive/
//  ├── config.json                 # workspace metadata + spaces list
//  ├── spaces/
//  │   ├── space_<id>.json         # per-space flow data (nodes, edges, viewport)
//  │   └── ...
//  ├── assets/                     # user media (images, videos, documents)
//  │   ├── images/
//  │   ├── videos/
//  │   └── documents/
//  ├── agents/                     # AI agent configurations
//  ├── data/                       # databases, datasets, caches
//  │   ├── databases/
//  │   └── cache/
//  ├── plugins/                    # custom node plugins / extensions
//  └── logs/                       # execution logs, audit trail

const HIVE_SUBDIRS: &[&str] = &[
    "spaces",
    "assets/images",
    "assets/videos",
    "assets/documents",
    "agents",
    "data/databases",
    "data/cache",
    "plugins",
    "logs",
];

// ─── Workspace config (lives at .hive/config.json) ──────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaceEntry {
    pub id: String,
    pub label: String,
    pub order: u32,
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

// ─── Helper: get .hive path ─────────────────────────────────

fn hive_dir(workspace_path: &str) -> PathBuf {
    PathBuf::from(workspace_path).join(".hive")
}

fn now_iso() -> String {
    // Simple UTC timestamp without chrono dependency
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", d.as_secs())
}

// ─── Initialize .hive structure ─────────────────────────────

fn init_hive_structure(workspace_path: &str, name: &str) -> Result<WorkspaceConfig, String> {
    let hive = hive_dir(workspace_path);

    // Create all subdirectories
    for sub in HIVE_SUBDIRS {
        fs::create_dir_all(hive.join(sub))
            .map_err(|e| format!("Failed to create .hive/{}: {}", sub, e))?;
    }

    // Check if config.json already exists (existing workspace)
    let config_path = hive.join("config.json");
    if config_path.exists() {
        let data = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config.json: {}", e))?;
        let config: WorkspaceConfig = serde_json::from_str(&data)
            .map_err(|e| format!("Failed to parse config.json: {}", e))?;
        return Ok(config);
    }

    // Create default config with one space
    let default_space = SpaceEntry {
        id: "space_1".to_string(),
        label: "1".to_string(),
        order: 0,
    };

    let config = WorkspaceConfig {
        version: 1,
        name: name.to_string(),
        created_at: now_iso(),
        updated_at: now_iso(),
        spaces: vec![default_space],
        active_space: "space_1".to_string(),
    };

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write config.json: {}", e))?;

    // Create default empty space file
    let space_data = SpaceData {
        id: "space_1".to_string(),
        label: "1".to_string(),
        nodes: vec![],
        edges: vec![],
        viewport: Viewport {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        },
    };

    let space_json = serde_json::to_string_pretty(&space_data)
        .map_err(|e| format!("Failed to serialize space: {}", e))?;
    fs::write(hive.join("spaces/space_1.json"), space_json)
        .map_err(|e| format!("Failed to write space file: {}", e))?;

    Ok(config)
}

// ─── Tauri commands: workspace init ─────────────────────────

#[tauri::command]
fn add_workspace(app: tauri::AppHandle, path: String) -> Result<Workspace, String> {
    let folder = PathBuf::from(&path);
    if !folder.exists() || !folder.is_dir() {
        return Err("Selected path is not a valid directory".to_string());
    }

    let mut workspaces = read_workspaces(&app)?;
    if workspaces.iter().any(|ws| ws.path == path) {
        return Err("Workspace already exists".to_string());
    }

    let name = folder
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".to_string());

    let hive = hive_dir(&path);
    let is_initialized = hive.join("config.json").exists();

    // Always ensure full structure + config
    init_hive_structure(&path, &name)?;

    let workspace = Workspace {
        name,
        path: path.clone(),
        is_initialized,
    };

    workspaces.push(workspace.clone());
    write_workspaces(&app, &workspaces)?;
    Ok(workspace)
}

// ─── Tauri commands: workspace config ───────────────────────

#[tauri::command]
fn load_workspace_config(workspace_path: String) -> Result<WorkspaceConfig, String> {
    let config_path = hive_dir(&workspace_path).join("config.json");
    if !config_path.exists() {
        // Auto-init if opened for the first time
        let name = PathBuf::from(&workspace_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Untitled".to_string());
        return init_hive_structure(&workspace_path, &name);
    }
    let data = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse config: {}", e))
}

#[tauri::command]
fn save_workspace_config(workspace_path: String, config: WorkspaceConfig) -> Result<(), String> {
    let config_path = hive_dir(&workspace_path).join("config.json");
    let mut config = config;
    config.updated_at = now_iso();
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, json).map_err(|e| format!("Failed to write config: {}", e))?;
    Ok(())
}

// ─── Tauri commands: space CRUD ─────────────────────────────

#[tauri::command]
fn load_space(workspace_path: String, space_id: String) -> Result<SpaceData, String> {
    let path = hive_dir(&workspace_path)
        .join("spaces")
        .join(format!("{}.json", space_id));

    if !path.exists() {
        // Return empty space if file missing
        return Ok(SpaceData {
            id: space_id.clone(),
            label: space_id,
            nodes: vec![],
            edges: vec![],
            viewport: Viewport {
                x: 0.0,
                y: 0.0,
                zoom: 1.0,
            },
        });
    }

    let data = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read space: {}", e))?;
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse space: {}", e))
}

#[tauri::command]
fn save_space(workspace_path: String, space: SpaceData) -> Result<(), String> {
    let spaces_dir = hive_dir(&workspace_path).join("spaces");
    fs::create_dir_all(&spaces_dir)
        .map_err(|e| format!("Failed to create spaces dir: {}", e))?;

    let path = spaces_dir.join(format!("{}.json", space.id));
    let json = serde_json::to_string_pretty(&space)
        .map_err(|e| format!("Failed to serialize space: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write space: {}", e))?;
    Ok(())
}

#[tauri::command]
fn create_space(workspace_path: String, space_id: String, label: String) -> Result<SpaceData, String> {
    let space = SpaceData {
        id: space_id.clone(),
        label,
        nodes: vec![],
        edges: vec![],
        viewport: Viewport {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        },
    };

    save_space(workspace_path.clone(), space.clone())?;

    // Also update config.json to add the new space entry
    let config_path = hive_dir(&workspace_path).join("config.json");
    if config_path.exists() {
        let data = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let mut config: WorkspaceConfig = serde_json::from_str(&data)
            .map_err(|e| format!("Failed to parse config: {}", e))?;

        let next_order = config.spaces.iter().map(|s| s.order).max().unwrap_or(0) + 1;
        config.spaces.push(SpaceEntry {
            id: space_id.clone(),
            label: space.label.clone(),
            order: next_order,
        });
        config.active_space = space_id;
        config.updated_at = now_iso();

        let json = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        fs::write(&config_path, json)
            .map_err(|e| format!("Failed to write config: {}", e))?;
    }

    Ok(space)
}

#[tauri::command]
fn delete_space(workspace_path: String, space_id: String) -> Result<(), String> {
    // Delete the space file
    let path = hive_dir(&workspace_path)
        .join("spaces")
        .join(format!("{}.json", space_id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete space: {}", e))?;
    }

    // Remove from config
    let config_path = hive_dir(&workspace_path).join("config.json");
    if config_path.exists() {
        let data = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let mut config: WorkspaceConfig = serde_json::from_str(&data)
            .map_err(|e| format!("Failed to parse config: {}", e))?;

        config.spaces.retain(|s| s.id != space_id);
        if config.active_space == space_id {
            config.active_space = config
                .spaces
                .first()
                .map(|s| s.id.clone())
                .unwrap_or_default();
        }
        config.updated_at = now_iso();

        let json = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        fs::write(&config_path, json)
            .map_err(|e| format!("Failed to write config: {}", e))?;
    }

    Ok(())
}

// ─── Notification ───────────────────────────────────────────

#[tauri::command]
fn send_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| format!("Failed to send notification: {}", e))?;
    Ok(())
}
// ─── Ollama Chat ─────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct OllamaMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct OllamaOptions {
    temperature: f64,
    num_predict: u32,
}

#[derive(Serialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
    options: OllamaOptions,
}

#[derive(Deserialize)]
struct OllamaResponse {
    message: Option<OllamaMessage>,
}

#[tauri::command]
async fn ollama_chat(
    ollama_url: String,
    model: String,
    messages: Vec<OllamaMessage>,
    temperature: f64,
    max_tokens: u32,
) -> Result<String, String> {
    let req_body = OllamaRequest {
        model,
        messages,
        stream: false,
        options: OllamaOptions {
            temperature,
            num_predict: max_tokens,
        },
    };

    let client = reqwest::Client::new();
    let res = client
        .post(format!("{}/api/chat", ollama_url))
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to Ollama: {}", e))?;

    let resp_data: OllamaResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    if let Some(msg) = resp_data.message {
        Ok(msg.content)
    } else {
        Err("Ollama response contained no message".to_string())
    }
}

// ─── Entrypoint ─────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_workspaces,
            add_workspace,
            remove_workspace,
            send_notification,
            load_workspace_config,
            save_workspace_config,
            load_space,
            save_space,
            create_space,
            delete_space,
            ollama_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
