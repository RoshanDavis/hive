use std::fs;
use std::path::PathBuf;
use tauri::Manager;

use crate::models::{
    FlowNode, SpaceData, SpaceEntry, SpaceRollup, Viewport, Workspace, WorkspaceConfig,
};

pub const HIVE_SUBDIRS: &[&str] = &[
    "spaces",
    "storage",
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

/// Serialize a value as pretty-printed JSON and write it atomically. Saves
/// the 3-line `to_string_pretty → map_err → write_atomic` ceremony at every
/// call site and standardizes the "Failed to serialize" error message.
pub fn write_json<T: serde::Serialize>(
    path: &std::path::Path,
    value: &T,
) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Failed to serialize JSON for {}: {}", path.display(), e))?;
    write_atomic(path, json.as_bytes())
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

// ─── Node defaults file paths ─────────────────────────────────

pub fn node_defaults_app_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&app_data).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(app_data.join("node-defaults.json"))
}

// ─── Tools registry file (global, at app_data_dir) ───────────

pub fn tools_app_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&app_data).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(app_data.join("tools.json"))
}

// ─── Custom-node directory (global, at app_data_dir) ──────────

pub fn custom_nodes_app_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let dir = app_data.join("custom-nodes");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create custom-nodes dir: {}", e))?;
    Ok(dir)
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

// ─── Initialize .hive structure ─────────────────────────────

pub fn init_hive_structure(workspace_path: &str, name: &str) -> Result<WorkspaceConfig, String> {
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
        status: None,
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

// ─── Space status rollup ────────────────────────────────────
//
// Compute the coarse rollup for a single space from its nodes' `status`
// fields, and patch the matching `SpaceEntry` in `.hive/config.json` if it
// changed. `Error` always wins over `Waiting`. Only persist `error`/`waiting`
// — `executing` is interrupt-on-exit (load_space sweeps it to error) and
// never belongs on disk, and `success`/`pending` are not user-actionable.

pub fn compute_space_rollup(nodes: &[FlowNode]) -> Option<SpaceRollup> {
    let mut has_waiting = false;
    for node in nodes {
        let status = node
            .data
            .as_object()
            .and_then(|o| o.get("status"))
            .and_then(|v| v.as_str());
        match status {
            Some("error") => return Some(SpaceRollup::Error),
            Some("waiting") => has_waiting = true,
            _ => {}
        }
    }
    if has_waiting {
        Some(SpaceRollup::Waiting)
    } else {
        None
    }
}

/// Patch `.hive/config.json` to record `new_rollup` on the matching space.
/// Skip the disk write when the value is unchanged so a steady-state run
/// (no transitions) adds zero extra I/O. Best-effort: a failure here must
/// not break the caller's save (`save_space` calls this then continues).
pub fn update_space_rollup_in_config(
    workspace_path: &str,
    space_id: &str,
    new_rollup: Option<SpaceRollup>,
) -> Result<(), String> {
    let config_path = hive_dir(workspace_path).join("config.json");
    if !config_path.exists() {
        return Ok(());
    }
    let data = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let mut config: WorkspaceConfig = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse config: {}", e))?;
    let entry = match config.spaces.iter_mut().find(|s| s.id == space_id) {
        Some(e) => e,
        None => return Ok(()),
    };
    if entry.status == new_rollup {
        return Ok(());
    }
    entry.status = new_rollup;
    config.updated_at = now_iso();
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    write_atomic(&config_path, json.as_bytes())?;
    Ok(())
}
