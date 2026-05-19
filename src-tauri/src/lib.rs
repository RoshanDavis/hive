use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub name: String,
    pub path: String,
    pub is_initialized: bool,
}

/// Get the path to the workspaces.json config file inside app data dir
fn get_workspaces_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&app_data).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(app_data.join("workspaces.json"))
}

/// Read persisted workspaces from disk
fn read_workspaces(app: &tauri::AppHandle) -> Result<Vec<Workspace>, String> {
    let file = get_workspaces_file(app)?;
    if !file.exists() {
        return Ok(vec![]);
    }
    let data = fs::read_to_string(&file).map_err(|e| format!("Failed to read workspaces: {}", e))?;
    let workspaces: Vec<Workspace> =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse workspaces: {}", e))?;
    Ok(workspaces)
}

/// Write workspaces list to disk
fn write_workspaces(app: &tauri::AppHandle, workspaces: &[Workspace]) -> Result<(), String> {
    let file = get_workspaces_file(app)?;
    let data =
        serde_json::to_string_pretty(workspaces).map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(&file, data).map_err(|e| format!("Failed to write workspaces: {}", e))?;
    Ok(())
}

/// Returns all saved workspaces, re-checking if .hive folders still exist
#[tauri::command]
fn get_workspaces(app: tauri::AppHandle) -> Result<Vec<Workspace>, String> {
    let mut workspaces = read_workspaces(&app)?;
    // Re-validate each workspace's .hive status
    for ws in workspaces.iter_mut() {
        let hive_dir = PathBuf::from(&ws.path).join(".hive");
        ws.is_initialized = hive_dir.exists() && hive_dir.is_dir();
    }
    write_workspaces(&app, &workspaces)?;
    Ok(workspaces)
}

/// Initialize a workspace from a given folder path.
/// Checks for .hive folder; creates it if missing.
/// Adds to persisted workspace list.
#[tauri::command]
fn add_workspace(app: tauri::AppHandle, path: String) -> Result<Workspace, String> {
    let folder = PathBuf::from(&path);
    if !folder.exists() || !folder.is_dir() {
        return Err("Selected path is not a valid directory".to_string());
    }

    // Check if already registered
    let mut workspaces = read_workspaces(&app)?;
    if workspaces.iter().any(|ws| ws.path == path) {
        return Err("Workspace already exists".to_string());
    }

    let hive_dir = folder.join(".hive");
    let is_initialized = if hive_dir.exists() && hive_dir.is_dir() {
        true
    } else {
        // Create .hive directory for new workspace
        fs::create_dir_all(&hive_dir)
            .map_err(|e| format!("Failed to create .hive directory: {}", e))?;
        false
    };

    // Derive workspace name from folder name
    let name = folder
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".to_string());

    let workspace = Workspace {
        name,
        path: path.clone(),
        is_initialized,
    };

    workspaces.push(workspace.clone());
    write_workspaces(&app, &workspaces)?;

    Ok(workspace)
}

/// Remove a workspace from the persisted list (does NOT delete .hive folder)
#[tauri::command]
fn remove_workspace(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let mut workspaces = read_workspaces(&app)?;
    workspaces.retain(|ws| ws.path != path);
    write_workspaces(&app, &workspaces)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_workspaces,
            add_workspace,
            remove_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
