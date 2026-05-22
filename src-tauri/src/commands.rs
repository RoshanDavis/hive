use std::fs;
use std::path::PathBuf;

use crate::models::{
    OllamaMessage, OllamaOptions, OllamaRequest, OllamaResponse, SpaceData, SpaceEntry,
    Workspace, WorkspaceConfig,
};
use crate::utils::{
    cleanup_unused_directories, hive_dir, init_hive_structure, now_iso, read_workspaces,
    write_workspaces, write_atomic,
};

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
    };

    workspaces.push(workspace.clone());
    write_workspaces(&app, &workspaces)?;
    Ok(workspace)
}

#[tauri::command]
pub fn load_workspace_config(workspace_path: String) -> Result<WorkspaceConfig, String> {
    // Migrate legacy 'databases' folder to 'storage' if present
    let hive_path = hive_dir(&workspace_path);
    let legacy_db_dir = hive_path.join("databases");
    let storage_dir = hive_path.join("storage");
    if legacy_db_dir.exists() && legacy_db_dir.is_dir() {
        if !storage_dir.exists() {
            fs::rename(&legacy_db_dir, &storage_dir)
                .map_err(|e| format!("Failed to migrate legacy 'databases' folder to 'storage': {}", e))?;
        } else {
            // Merging contents in case both directories exist
            if let Ok(entries) = fs::read_dir(&legacy_db_dir) {
                for entry in entries.filter_map(Result::ok) {
                    let path = entry.path();
                    if let Some(name) = path.file_name() {
                        let target = storage_dir.join(name);
                        if path.is_dir() {
                            let _ = fs::create_dir_all(&target);
                            if let Ok(sub_entries) = fs::read_dir(&path) {
                                for sub_entry in sub_entries.filter_map(Result::ok) {
                                    let sub_path = sub_entry.path();
                                    if let Some(sub_name) = sub_path.file_name() {
                                        let _ = fs::rename(&sub_path, target.join(sub_name));
                                    }
                                }
                            }
                        } else {
                            let _ = fs::rename(&path, &target);
                        }
                    }
                }
            }
            let _ = fs::remove_dir_all(&legacy_db_dir);
        }
    }

    // Auto-clean any empty legacy directories
    cleanup_unused_directories(&workspace_path);

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
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    write_atomic(&config_path, json.as_bytes())?;
    Ok(())
}

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
        } else if node.node_type == "output" {
            // Guarantee outputContent string exists in loaded frontend state
            if let Some(obj) = node.data.as_object_mut() {
                if !obj.contains_key("outputContent") {
                    obj.insert("outputContent".to_string(), serde_json::json!(""));
                }
            }
        }
    }

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
                    let db_json = serde_json::to_string_pretty(records)
                        .map_err(|e| format!("Failed to serialize database records: {}", e))?;
                    write_atomic(&db_file, db_json.as_bytes())?;
                }
                // Strip the records from the node data written to space_<id>.json
                obj.remove("records");
            }
        } else if node.node_type == "chat" {
            if let Some(obj) = node.data.as_object_mut() {
                // Strip large messages history from workspace json files
                obj.remove("messages");
            }
        } else if node.node_type == "output" {
            if let Some(obj) = node.data.as_object_mut() {
                // Strip outputContent history from workspace json files
                obj.remove("outputContent");
            }
        }
    }

    let spaces_dir = hive_dir(&workspace_path).join("spaces");
    fs::create_dir_all(&spaces_dir)
        .map_err(|e| format!("Failed to create spaces dir: {}", e))?;

    let path = spaces_dir.join(format!("{}.json", space.id));
    let json = serde_json::to_string_pretty(&space)
        .map_err(|e| format!("Failed to serialize space: {}", e))?;
    write_atomic(&path, json.as_bytes())?;
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
        });
        config.active_space = space_id;
        config.updated_at = now_iso();

        let json = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        write_atomic(&config_path, json.as_bytes())?;
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

        let json = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        write_atomic(&config_path, json.as_bytes())?;
    }

    Ok(())
}

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

#[tauri::command]
pub async fn ollama_chat(
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
