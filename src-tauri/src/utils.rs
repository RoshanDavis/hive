use std::fs;
use std::path::PathBuf;
use tauri::Manager;

use crate::models::{SpaceData, SpaceEntry, Viewport, Workspace, WorkspaceConfig};

pub const HIVE_SUBDIRS: &[&str] = &[
    "spaces",
    "databases",
];

// ─── App-level workspace registry ────────────────────────────

pub fn get_workspaces_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&app_data).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(app_data.join("workspaces.json"))
}

pub fn read_workspaces(app: &tauri::AppHandle) -> Result<Vec<Workspace>, String> {
    let file = get_workspaces_file(app)?;
    if !file.exists() {
        return Ok(vec![]);
    }
    let data = fs::read_to_string(&file).map_err(|e| format!("Failed to read workspaces: {}", e))?;
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse workspaces: {}", e))
}

pub fn write_atomic(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Target path has no parent directory".to_string())?;
    
    let file_name = path
        .file_name()
        .ok_or_else(|| "Target path has no file name".to_string())?;
    
    let temp_path = parent.join(format!("{}.tmp", file_name.to_string_lossy()));
    
    // Write to temp file
    fs::write(&temp_path, data)
        .map_err(|e| format!("Failed to write temporary file: {}", e))?;
    
    // Atomically replace target file
    fs::rename(&temp_path, path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("Failed to atomically replace target file: {}", e)
    })?;
    
    Ok(())
}

pub fn write_workspaces(app: &tauri::AppHandle, workspaces: &[Workspace]) -> Result<(), String> {
    let file = get_workspaces_file(app)?;
    let data = serde_json::to_string_pretty(workspaces)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    write_atomic(&file, data.as_bytes())?;
    Ok(())
}

// ─── Helper: get .hive path ─────────────────────────────────

pub fn hive_dir(workspace_path: &str) -> PathBuf {
    PathBuf::from(workspace_path).join(".hive")
}

pub fn now_iso() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", d.as_secs())
}

pub fn cleanup_unused_directories(workspace_path: &str) {
    let hive = hive_dir(workspace_path);
    let unused = &[
        "assets/images",
        "assets/videos",
        "assets/documents",
        "assets",
        "agents",
        "data/databases",
        "data/cache",
        "data",
        "plugins",
        "logs",
    ];
    for sub in unused {
        let dir_path = hive.join(sub);
        if dir_path.exists() && dir_path.is_dir() {
            if let Ok(entries) = fs::read_dir(&dir_path) {
                if entries.count() == 0 {
                    let _ = fs::remove_dir(&dir_path);
                }
            }
        }
    }
}

// ─── Initialize .hive structure ─────────────────────────────

pub fn init_hive_structure(workspace_path: &str, name: &str) -> Result<WorkspaceConfig, String> {
    let hive = hive_dir(workspace_path);

    // Auto-clean any empty legacy directories
    cleanup_unused_directories(workspace_path);

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
    write_atomic(&config_path, json.as_bytes())?;

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
    write_atomic(&hive.join("spaces/space_1.json"), space_json.as_bytes())?;

    Ok(config)
}
