//! Workspace + space CRUD, per-node history cleanup, OS notifications.
//!
//! All disk writes go through [`crate::utils::write_atomic`] /
//! [`crate::utils::write_json`] (write-to-tempfile + rename) for crash safety.
//! The `executing → error` sanity sweep in `load_space` lives here too.

use std::fs;
use std::path::PathBuf;

use crate::models::{
    SpaceData, SpaceEntry, Workspace, WorkspaceConfig, WorkspaceStatusRollup,
};
use crate::utils::{
    compute_space_rollup, hive_dir, init_hive_structure, now_iso, read_workspaces,
    update_space_rollup_in_config, write_json, write_workspaces,
};

// ─── Workspace registry ──────────────────────────────────────

#[tauri::command]
pub fn get_workspaces(app: tauri::AppHandle) -> Result<Vec<Workspace>, String> {
    let mut workspaces = read_workspaces(&app)?;
    for ws in workspaces.iter_mut() {
        let hive_dir = PathBuf::from(&ws.path).join(".hive");
        ws.is_initialized = hive_dir.exists() && hive_dir.is_dir();
    }
    write_workspaces(&app, &workspaces)?;
    Ok(workspaces)
}

#[tauri::command]
pub fn remove_workspace(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let mut workspaces = read_workspaces(&app)?;
    workspaces.retain(|ws| ws.path != path);
    write_workspaces(&app, &workspaces)?;
    Ok(())
}

#[tauri::command]
pub fn add_workspace(app: tauri::AppHandle, path: String) -> Result<Workspace, String> {
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
        background_execution: true,
    };

    workspaces.push(workspace.clone());
    write_workspaces(&app, &workspaces)?;
    Ok(workspace)
}

/// Batched per-workspace status rollup for the Dashboard's colored dot.
///
/// For each `path`, reads `.hive/config.json` and OR-reduces the per-space
/// `status` field across every `SpaceEntry`. Returns one entry per requested
/// path. A workspace whose config is missing, unparsable, or empty resolves
/// to `{has_error: false, has_waiting: false}` — never an error, because
/// failing the call would blank the entire Dashboard for one bad workspace.
///
/// Scale: N small file reads at Dashboard mount. Acceptable into the
/// thousands of workspaces. Avoids loading any space file or node payload.
#[tauri::command]
pub fn get_workspace_status_rollups(paths: Vec<String>) -> Vec<WorkspaceStatusRollup> {
    paths
        .into_iter()
        .map(|path| {
            let config_path = hive_dir(&path).join("config.json");
            let mut has_error = false;
            let mut has_waiting = false;
            if let Ok(data) = fs::read_to_string(&config_path) {
                if let Ok(config) = serde_json::from_str::<WorkspaceConfig>(&data) {
                    for entry in &config.spaces {
                        match entry.status {
                            Some(crate::models::SpaceRollup::Error) => has_error = true,
                            Some(crate::models::SpaceRollup::Waiting) => has_waiting = true,
                            None => {}
                        }
                    }
                }
            }
            WorkspaceStatusRollup {
                path,
                has_error,
                has_waiting,
            }
        })
        .collect()
}

#[tauri::command]
pub fn set_workspace_background_execution(
    app: tauri::AppHandle,
    path: String,
    enabled: bool,
) -> Result<(), String> {
    let mut workspaces = read_workspaces(&app)?;
    let target = workspaces
        .iter_mut()
        .find(|ws| ws.path == path)
        .ok_or_else(|| format!("Workspace not found: {}", path))?;
    target.background_execution = enabled;
    write_workspaces(&app, &workspaces)
}

#[tauri::command]
pub fn load_workspace_config(workspace_path: String) -> Result<WorkspaceConfig, String> {
    let hive_path = hive_dir(&workspace_path);
    let config_path = hive_path.join("config.json");
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
pub fn save_workspace_config(workspace_path: String, config: WorkspaceConfig) -> Result<(), String> {
    let config_path = hive_dir(&workspace_path).join("config.json");
    let mut config = config;
    config.updated_at = now_iso();
    write_json(&config_path, &config)
}

// ─── Space CRUD + post-load sanity sweep ─────────────────────

#[tauri::command]
pub fn load_space(workspace_path: String, space_id: String) -> Result<SpaceData, String> {
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
            viewport: crate::models::Viewport {
                x: 0.0,
                y: 0.0,
                zoom: 1.0,
            },
        });
    }

    let data = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read space: {}", e))?;
    let mut space: SpaceData = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse space: {}", e))?;

    // Load separate database records from storage space-specific directories
    let storage_dir = hive_dir(&workspace_path).join("storage");
    let space_storage_dir = storage_dir.join(&space_id);

    // Sanity sweep first, **before** attaching storage/chat enrichments so
    // the optional write-back below mirrors what `save_space` would produce
    // (no records/messages in space file). Any node still marked `executing`
    // on load was interrupted by an app exit or crash — promote to `error`.
    let mut swept_any = false;
    for node in space.nodes.iter_mut() {
        if let Some(obj) = node.data.as_object_mut() {
            let is_executing = obj
                .get("status")
                .and_then(|v| v.as_str())
                .map(|s| s == "executing")
                .unwrap_or(false);
            if is_executing {
                obj.insert("status".to_string(), serde_json::json!("error"));
                obj.insert(
                    "error".to_string(),
                    serde_json::json!("Interrupted by app exit"),
                );
                obj.remove("statusRunId");
                swept_any = true;
            }
        }
    }

    // Persist the sweep so we don't re-promote the same nodes on every load.
    // Best-effort: failure here just means the next load will re-sweep — no
    // user-visible breakage. Done before enrichment so the on-disk file stays
    // in the same shape `save_space` writes (records/messages separated out).
    if swept_any {
        let space_path = hive_dir(&workspace_path)
            .join("spaces")
            .join(format!("{}.json", space.id));
        let _ = write_json(&space_path, &space);
    }

    // Second pass: attach storage records / ensure chat messages array.
    for node in space.nodes.iter_mut() {
        if node.node_type == "jsonStorage" {
            let db_file = space_storage_dir.join(format!("{}.json", node.id));
            let mut loaded_records = None;

            if db_file.exists() {
                if let Ok(db_data) = fs::read_to_string(&db_file) {
                    if let Ok(records) = serde_json::from_str::<serde_json::Value>(&db_data) {
                        loaded_records = Some(records);
                    }
                }
            }

            if let Some(records) = loaded_records {
                if let Some(obj) = node.data.as_object_mut() {
                    obj.insert("records".to_string(), records);
                }
            } else {
                // Default to empty array if no database file exists yet
                if let Some(obj) = node.data.as_object_mut() {
                    if !obj.contains_key("records") {
                        obj.insert("records".to_string(), serde_json::json!([]));
                    }
                }
            }
        } else if node.node_type == "chat" {
            // Guarantee messages array exists in loaded frontend state
            if let Some(obj) = node.data.as_object_mut() {
                if !obj.contains_key("messages") {
                    obj.insert("messages".to_string(), serde_json::json!([]));
                }
            }
        } else if node.node_type == "agent" {
            // Reattach the agent's internal storage-slot records from disk. Only
            // when a storage slot is present (it's an object); a null slot stays
            // null. Missing/unparseable file degrades to an empty array.
            if let Some(obj) = node.data.as_object_mut() {
                if let Some(storage) = obj.get_mut("storage").and_then(|s| s.as_object_mut()) {
                    let db_file = space_storage_dir.join(format!("{}.json", node.id));
                    let records = fs::read_to_string(&db_file)
                        .ok()
                        .and_then(|d| serde_json::from_str::<serde_json::Value>(&d).ok())
                        .unwrap_or_else(|| serde_json::json!([]));
                    storage.insert("records".to_string(), records);
                }
            }
        }
    }

    // Refresh the per-space rollup on `.hive/config.json`. The executing→error
    // sweep above can flip a space from clean to errored at load time, and we
    // want the Dashboard to see that without waiting for the next save. Skipped
    // when unchanged. Best-effort: a write failure here doesn't fail load.
    let rollup = compute_space_rollup(&space.nodes);
    let _ = update_space_rollup_in_config(&workspace_path, &space.id, rollup);

    Ok(space)
}

#[tauri::command]
pub fn save_space(workspace_path: String, mut space: SpaceData) -> Result<(), String> {
    let storage_dir = hive_dir(&workspace_path).join("storage");
    let space_storage_dir = storage_dir.join(&space.id);
    fs::create_dir_all(&space_storage_dir)
        .map_err(|e| format!("Failed to create space storage dir: {}", e))?;

    // Decouple and save JSON storage records, and strip dynamic fields for pristine space JSON
    for node in space.nodes.iter_mut() {
        if node.node_type == "jsonStorage" {
            if let Some(obj) = node.data.as_object_mut() {
                if let Some(records) = obj.get("records") {
                    let db_file = space_storage_dir.join(format!("{}.json", node.id));
                    write_json(&db_file, records)?;
                }
                // Strip the records from the node data written to space_<id>.json
                obj.remove("records");
            }
        } else if node.node_type == "chat" {
            if let Some(obj) = node.data.as_object_mut() {
                // Strip large messages history from workspace json files
                obj.remove("messages");
            }
        } else if node.node_type == "agent" {
            // Decouple the agent's internal storage-slot records to their own
            // file (mirrors jsonStorage) so the space JSON stays small. The
            // records live nested at data.storage.records.
            if let Some(obj) = node.data.as_object_mut() {
                if let Some(storage) = obj.get_mut("storage").and_then(|s| s.as_object_mut()) {
                    if let Some(records) = storage.get("records") {
                        let db_file = space_storage_dir.join(format!("{}.json", node.id));
                        write_json(&db_file, records)?;
                    }
                    storage.remove("records");
                }
            }
        }

        // `logs` is transient per-run output (e.g. custom script nodes): regenerated on
        // every run and shown only in the inspector, so it never belongs in the space file.
        if let Some(obj) = node.data.as_object_mut() {
            obj.remove("logs");
        }
    }

    let spaces_dir = hive_dir(&workspace_path).join("spaces");
    fs::create_dir_all(&spaces_dir)
        .map_err(|e| format!("Failed to create spaces dir: {}", e))?;

    let path = spaces_dir.join(format!("{}.json", space.id));
    write_json(&path, &space)?;

    // Refresh the per-space rollup on `.hive/config.json` so the Dashboard
    // dot stays accurate even when no session is attached. Skipped when
    // unchanged; best-effort (a config-write failure shouldn't fail the save).
    let rollup = compute_space_rollup(&space.nodes);
    let _ = update_space_rollup_in_config(&workspace_path, &space.id, rollup);

    Ok(())
}

#[tauri::command]
pub fn create_space(
    workspace_path: String,
    space_id: String,
    label: String,
) -> Result<SpaceData, String> {
    let space = SpaceData {
        id: space_id.clone(),
        label,
        nodes: vec![],
        edges: vec![],
        viewport: crate::models::Viewport {
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
            status: None,
        });
        config.active_space = space_id;
        config.updated_at = now_iso();

        write_json(&config_path, &config)?;
    }

    Ok(space)
}

#[tauri::command]
pub fn delete_space(workspace_path: String, space_id: String) -> Result<(), String> {
    let path = hive_dir(&workspace_path)
        .join("spaces")
        .join(format!("{}.json", space_id));

    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete space file: {}", e))?;
    }

    // Delete the entire chats folder for this space
    let space_chats_dir = hive_dir(&workspace_path).join("chats").join(&space_id);
    if space_chats_dir.exists() && space_chats_dir.is_dir() {
        fs::remove_dir_all(&space_chats_dir)
            .map_err(|e| format!("Failed to delete space chats directory: {}", e))?;
    }

    // Delete the entire storage folder for this space
    let space_storage_dir = hive_dir(&workspace_path).join("storage").join(&space_id);
    if space_storage_dir.exists() && space_storage_dir.is_dir() {
        fs::remove_dir_all(&space_storage_dir)
            .map_err(|e| format!("Failed to delete space storage directory: {}", e))?;
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

        write_json(&config_path, &config)?;
    }

    Ok(())
}

// ─── Per-node history cleanup ────────────────────────────────

#[tauri::command]
pub fn delete_chat_history(
    workspace_path: String,
    space_id: String,
    chat_node_id: String,
) -> Result<(), String> {
    let chat_file = hive_dir(&workspace_path)
        .join("chats")
        .join(&space_id)
        .join(format!("{}.json", chat_node_id));
    if chat_file.exists() {
        fs::remove_file(&chat_file)
            .map_err(|e| format!("Failed to delete chat history: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_storage_history(
    workspace_path: String,
    space_id: String,
    database_node_id: String,
) -> Result<(), String> {
    let db_file = hive_dir(&workspace_path)
        .join("storage")
        .join(&space_id)
        .join(format!("{}.json", database_node_id));
    if db_file.exists() {
        fs::remove_file(&db_file)
            .map_err(|e| format!("Failed to delete storage history: {}", e))?;
    }
    Ok(())
}

// ─── OS notifications ────────────────────────────────────────

#[tauri::command]
pub fn send_notification(
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

