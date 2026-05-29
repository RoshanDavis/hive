use std::fs;
use std::path::{Path, PathBuf};

use crate::models::{
    CustomNodeDefinition, NodeDefaultsConfig, OllamaMessage, OllamaOptions, OllamaRequest,
    OllamaResponse, SpaceData, SpaceEntry, Workspace, WorkspaceConfig,
};
use crate::utils::{
    cleanup_unused_directories, custom_nodes_app_dir, hive_dir, init_hive_structure,
    node_defaults_app_file, now_iso, read_workspaces, write_workspaces, write_atomic,
};
use crate::vault::{
    get_or_create_master_key, global_vault_path, local_vault_path, CredentialMeta,
    CredentialVault,
};

// ─── Credential vault helpers ────────────────────────────────

fn make_global_vault(app: &tauri::AppHandle) -> Result<CredentialVault, String> {
    let key = get_or_create_master_key()?;
    let path = global_vault_path(app)?;
    Ok(CredentialVault::new(path, "global", key))
}

fn make_local_vault(workspace_path: &str) -> Result<CredentialVault, String> {
    let key = get_or_create_master_key()?;
    Ok(CredentialVault::new(
        local_vault_path(workspace_path),
        "local",
        key,
    ))
}

// Resolves the right vault for a scope string, validating that "local" was
// given the workspace path it needs.
fn vault_for_scope(
    app: &tauri::AppHandle,
    scope: &str,
    workspace_path: Option<&str>,
) -> Result<CredentialVault, String> {
    match scope {
        "global" => make_global_vault(app),
        "local" => {
            let wp = workspace_path
                .ok_or_else(|| "Local scope requires workspace_path".to_string())?;
            make_local_vault(wp)
        }
        other => Err(format!("Unknown credential scope: {}", other)),
    }
}

fn resolve_credential_values(
    app: &tauri::AppHandle,
    credential_id: &str,
    scope_hint: Option<&str>,
    workspace_path: Option<&str>,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let global = make_global_vault(app)?;
    let local = workspace_path.map(make_local_vault).transpose()?;

    let try_local = |v: &Option<CredentialVault>| -> Result<Option<_>, String> {
        match v {
            Some(vault) => vault.resolve(credential_id),
            None => Ok(None),
        }
    };

    // Local-first is the default; only "global" hint flips the lookup order.
    let resolved = if scope_hint == Some("global") {
        global.resolve(credential_id)?.or(try_local(&local)?)
    } else {
        try_local(&local)?.or(global.resolve(credential_id)?)
    };

    resolved.ok_or_else(|| format!("Credential not found: {}", credential_id))
}

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

#[tauri::command]
pub async fn llm_chat(
    app: tauri::AppHandle,
    provider: String,
    base_url: Option<String>,
    api_key: Option<String>,
    credential_id: Option<String>,
    credential_scope: Option<String>,
    workspace_path: Option<String>,
    model_name: String,
    messages: Vec<OllamaMessage>,
    temperature: f64,
    max_tokens: u32,
) -> Result<String, String> {
    // Rust-side credential resolution: if a credentialId is provided, look it up
    // in the appropriate vault and override base_url/api_key from the stored values.
    // The plaintext secret never crosses back into the renderer.
    let (api_key, base_url) = if let Some(id) = credential_id.as_deref() {
        let values = resolve_credential_values(
            &app,
            id,
            credential_scope.as_deref(),
            workspace_path.as_deref(),
        )?;
        let resolved_key = values
            .get("apiKey")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or(api_key);
        let resolved_url = values
            .get("baseURL")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or(base_url);
        (resolved_key, resolved_url)
    } else {
        (api_key, base_url)
    };

    let provider_lower = provider.to_lowercase();

    if provider_lower == "ollama" {
        let url = base_url.unwrap_or_else(|| "http://localhost:11434".to_string());
        ollama_chat(url, model_name, messages, temperature, max_tokens).await
    } else if provider_lower == "openai" || provider_lower == "other" || provider_lower == "google" {
        let url = match provider_lower.as_str() {
            "openai" => base_url.unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
            "google" => base_url.unwrap_or_else(|| "https://generativelanguage.googleapis.com/v1beta/openai".to_string()),
            _ => base_url.unwrap_or_default(),
        };

        if url.is_empty() {
            return Err("Base URL is required".to_string());
        }

        let key = api_key.unwrap_or_default();
        let client = reqwest::Client::new();
        let mut req = client.post(format!("{}/chat/completions", url));
        
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }

        let req_body = serde_json::json!({
            "model": model_name,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        });

        let res = req.json(&req_body)
            .send()
            .await
            .map_err(|e| format!("Failed to send request to LLM: {}", e))?;

        if !res.status().is_success() {
            let status = res.status();
            let err_text = res.text().await.unwrap_or_default();
            return Err(format!("LLM provider returned error status ({}): {}", status, err_text));
        }

        let resp_data: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse response from LLM: {}", e))?;

        if let Some(choices) = resp_data.get("choices").and_then(|c| c.as_array()) {
            if let Some(first_choice) = choices.first() {
                if let Some(content) = first_choice.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_str()) {
                    return Ok(content.to_string());
                }
            }
        }

        Err("LLM response contained no content choice".to_string())
    } else if provider_lower == "anthropic" {
        let url = base_url.unwrap_or_else(|| "https://api.anthropic.com".to_string());
        let key = api_key.unwrap_or_default();

        if key.is_empty() {
            return Err("Anthropic API Key is required".to_string());
        }

        let mut system_prompt = String::new();
        let mut anthropic_messages = Vec::new();

        for msg in messages {
            if msg.role.to_lowercase() == "system" {
                system_prompt = msg.content;
            } else {
                anthropic_messages.push(serde_json::json!({
                    "role": msg.role,
                    "content": msg.content
                }));
            }
        }

        let client = reqwest::Client::new();
        let req = client.post(format!("{}/v1/messages", url))
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json");

        let mut req_body = serde_json::json!({
            "model": model_name,
            "messages": anthropic_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        });

        if !system_prompt.is_empty() {
            if let Some(obj) = req_body.as_object_mut() {
                obj.insert("system".to_string(), serde_json::json!(system_prompt));
            }
        }

        let res = req.json(&req_body)
            .send()
            .await
            .map_err(|e| format!("Failed to send request to Anthropic: {}", e))?;

        if !res.status().is_success() {
            let status = res.status();
            let err_text = res.text().await.unwrap_or_default();
            return Err(format!("Anthropic returned error status ({}): {}", status, err_text));
        }

        let resp_data: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse response from Anthropic: {}", e))?;

        if let Some(content_array) = resp_data.get("content").and_then(|c| c.as_array()) {
            if let Some(first_content) = content_array.first() {
                if let Some(text) = first_content.get("text").and_then(|t| t.as_str()) {
                    return Ok(text.to_string());
                }
            }
        }

        Err("Anthropic response contained no text".to_string())
    } else {
        Err(format!("Unsupported provider: {}", provider))
    }
}

// ─── Credential vault IPC ────────────────────────────────────

#[tauri::command]
pub fn credential_list(
    app: tauri::AppHandle,
    workspace_path: Option<String>,
) -> Result<Vec<CredentialMeta>, String> {
    let global = make_global_vault(&app)?;
    let mut metas = global.list_meta()?;
    if let Some(wp) = workspace_path {
        let local = make_local_vault(&wp)?;
        metas.extend(local.list_meta()?);
    }
    Ok(metas)
}

#[tauri::command]
pub fn credential_add(
    app: tauri::AppHandle,
    scope: String,
    workspace_path: Option<String>,
    name: String,
    schema_type: String,
    provider: String,
    values: serde_json::Map<String, serde_json::Value>,
) -> Result<CredentialMeta, String> {
    let vault = vault_for_scope(&app, &scope, workspace_path.as_deref())?;
    vault.add(name, schema_type, provider, values)
}

#[tauri::command]
pub fn credential_update(
    app: tauri::AppHandle,
    scope: String,
    workspace_path: Option<String>,
    id: String,
    name: Option<String>,
    values: Option<serde_json::Map<String, serde_json::Value>>,
) -> Result<CredentialMeta, String> {
    let vault = vault_for_scope(&app, &scope, workspace_path.as_deref())?;
    vault.update(&id, name, values)
}

#[tauri::command]
pub fn credential_remove(
    app: tauri::AppHandle,
    scope: String,
    workspace_path: Option<String>,
    id: String,
) -> Result<(), String> {
    let vault = vault_for_scope(&app, &scope, workspace_path.as_deref())?;
    vault.remove(&id)
}

#[tauri::command]
pub fn credential_transfer(
    app: tauri::AppHandle,
    id: String,
    from_scope: String,
    to_scope: String,
    workspace_path: Option<String>,
) -> Result<CredentialMeta, String> {
    if from_scope == to_scope {
        return Err("Source and destination scopes are the same".to_string());
    }
    let source = vault_for_scope(&app, &from_scope, workspace_path.as_deref())?;
    let dest = vault_for_scope(&app, &to_scope, workspace_path.as_deref())?;
    let entry = source
        .take_entry(&id)?
        .ok_or_else(|| format!("Credential not found in {} vault: {}", from_scope, id))?;
    let meta = entry.to_meta(&to_scope);
    dest.insert_entry(entry)?;
    Ok(meta)
}

#[tauri::command]
pub fn credential_resolve(
    app: tauri::AppHandle,
    id: String,
    scope: Option<String>,
    workspace_path: Option<String>,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    resolve_credential_values(&app, &id, scope.as_deref(), workspace_path.as_deref())
}

// ─── Node defaults IPC ────────────────────────────────────────

fn read_node_defaults_file(path: &std::path::Path) -> Result<NodeDefaultsConfig, String> {
    if !path.exists() {
        return Ok(NodeDefaultsConfig::default());
    }
    let data = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read node defaults: {}", e))?;
    serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse node defaults: {}", e))
}

fn write_node_defaults_file(
    path: &std::path::Path,
    config: &NodeDefaultsConfig,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }
    let data = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize node defaults: {}", e))?;
    write_atomic(path, data.as_bytes())
}

#[tauri::command]
pub fn load_global_node_defaults(app: tauri::AppHandle) -> Result<NodeDefaultsConfig, String> {
    let path = node_defaults_app_file(&app)?;
    read_node_defaults_file(&path)
}

#[tauri::command]
pub fn save_global_node_defaults(
    app: tauri::AppHandle,
    config: NodeDefaultsConfig,
) -> Result<(), String> {
    let path = node_defaults_app_file(&app)?;
    write_node_defaults_file(&path, &config)
}

#[tauri::command]
pub fn load_workspace_node_defaults(
    workspace_path: String,
) -> Result<NodeDefaultsConfig, String> {
    let path = hive_dir(&workspace_path).join("node-defaults.json");
    read_node_defaults_file(&path)
}

#[tauri::command]
pub fn save_workspace_node_defaults(
    workspace_path: String,
    config: NodeDefaultsConfig,
) -> Result<(), String> {
    let path = hive_dir(&workspace_path).join("node-defaults.json");
    write_node_defaults_file(&path, &config)
}

// ─── Custom nodes IPC ─────────────────────────────────────────

fn custom_nodes_dir_for_scope(
    app: &tauri::AppHandle,
    scope: &str,
    workspace_path: Option<&str>,
) -> Result<PathBuf, String> {
    match scope {
        "global" => custom_nodes_app_dir(app),
        "workspace" => {
            let wp = workspace_path
                .ok_or_else(|| "Workspace scope requires workspace_path".to_string())?;
            Ok(hive_dir(wp).join("custom-nodes"))
        }
        other => Err(format!("Unknown custom node scope: {}", other)),
    }
}

/// Read every `<dir>/<id>/node.json`, skipping any folder whose definition is
/// missing or unparseable (graceful — never fail the whole list on one bad file).
fn read_custom_nodes_dir(dir: &Path) -> Result<Vec<CustomNodeDefinition>, String> {
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    let entries =
        fs::read_dir(dir).map_err(|e| format!("Failed to read custom-nodes dir: {}", e))?;
    for entry in entries.flatten() {
        let node_json = entry.path().join("node.json");
        if node_json.is_file() {
            if let Ok(data) = fs::read_to_string(&node_json) {
                if let Ok(def) = serde_json::from_str::<CustomNodeDefinition>(&data) {
                    out.push(def);
                }
            }
        }
    }
    Ok(out)
}

fn write_custom_node(dir: &Path, def: &CustomNodeDefinition) -> Result<(), String> {
    let node_dir = dir.join(&def.id);
    fs::create_dir_all(&node_dir)
        .map_err(|e| format!("Failed to create custom-node dir: {}", e))?;
    let path = node_dir.join("node.json");
    let json = serde_json::to_string_pretty(def)
        .map_err(|e| format!("Failed to serialize custom node: {}", e))?;
    write_atomic(&path, json.as_bytes())
}

fn delete_custom_node_dir(dir: &Path, id: &str) -> Result<(), String> {
    let node_dir = dir.join(id);
    if node_dir.exists() {
        fs::remove_dir_all(&node_dir)
            .map_err(|e| format!("Failed to delete custom node: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_global_custom_nodes(
    app: tauri::AppHandle,
) -> Result<Vec<CustomNodeDefinition>, String> {
    read_custom_nodes_dir(&custom_nodes_app_dir(&app)?)
}

#[tauri::command]
pub fn list_workspace_custom_nodes(
    workspace_path: String,
) -> Result<Vec<CustomNodeDefinition>, String> {
    read_custom_nodes_dir(&hive_dir(&workspace_path).join("custom-nodes"))
}

#[tauri::command]
pub fn save_global_custom_node(
    app: tauri::AppHandle,
    def: CustomNodeDefinition,
) -> Result<(), String> {
    write_custom_node(&custom_nodes_app_dir(&app)?, &def)
}

#[tauri::command]
pub fn save_workspace_custom_node(
    workspace_path: String,
    def: CustomNodeDefinition,
) -> Result<(), String> {
    write_custom_node(&hive_dir(&workspace_path).join("custom-nodes"), &def)
}

#[tauri::command]
pub fn delete_global_custom_node(app: tauri::AppHandle, id: String) -> Result<(), String> {
    delete_custom_node_dir(&custom_nodes_app_dir(&app)?, &id)
}

#[tauri::command]
pub fn delete_workspace_custom_node(
    workspace_path: String,
    id: String,
) -> Result<(), String> {
    delete_custom_node_dir(&hive_dir(&workspace_path).join("custom-nodes"), &id)
}

/// Move a custom-node folder between scopes (workspace ⇄ global). Mirrors
/// `credential_transfer`: read the def from the source, write it to the
/// destination, then remove the source folder.
#[tauri::command]
pub fn custom_node_transfer(
    app: tauri::AppHandle,
    id: String,
    from_scope: String,
    to_scope: String,
    workspace_path: Option<String>,
) -> Result<CustomNodeDefinition, String> {
    if from_scope == to_scope {
        return Err("Source and destination scopes are the same".to_string());
    }
    let from_dir = custom_nodes_dir_for_scope(&app, &from_scope, workspace_path.as_deref())?;
    let to_dir = custom_nodes_dir_for_scope(&app, &to_scope, workspace_path.as_deref())?;
    let node_json = from_dir.join(&id).join("node.json");
    if !node_json.is_file() {
        return Err(format!(
            "Custom node not found in {} scope: {}",
            from_scope, id
        ));
    }
    let data = fs::read_to_string(&node_json)
        .map_err(|e| format!("Failed to read custom node: {}", e))?;
    let def: CustomNodeDefinition = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse custom node: {}", e))?;
    write_custom_node(&to_dir, &def)?;
    delete_custom_node_dir(&from_dir, &id)?;
    Ok(def)
}

// ─── Tier-3 script nodes (sandboxed user executors) ───────────
//
// Source (`script.js`) and capability grants live on disk in the node folder and
// are read here — the renderer only supplies per-instance `input` + `config`, so a
// buggy/compromised renderer cannot widen a script's limits. Execution is synchronous
// inside an isolated QuickJS runtime; `ctx.fetch` is a gated, blocking host call whose
// allowlist + credential grants are enforced Rust-side. The sandbox itself (QuickJS
// runtime + gated fetch + SSRF guards) lives in the Tauri-free `hive_sandbox` crate;
// here we only read the on-disk definition/grants and supply a `CredentialResolver`.

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptLimitsRaw {
    timeout_ms: Option<u64>,
    memory_bytes: Option<usize>,
}

/// Bridges the sandbox crate's credential lookup to the Tauri vault. The plaintext is
/// resolved here, server-side, and never crosses back into the renderer or the JS heap.
struct VaultResolver {
    app: tauri::AppHandle,
    workspace_path: Option<String>,
}

impl hive_sandbox::CredentialResolver for VaultResolver {
    fn resolve(
        &self,
        credential_id: &str,
    ) -> Result<serde_json::Map<String, serde_json::Value>, String> {
        resolve_credential_values(&self.app, credential_id, None, self.workspace_path.as_deref())
    }
}

/// Read the on-disk entry filename for a custom node, defaulting to "script.js".
fn script_entry_for(folder: &Path) -> String {
    let node_json = folder.join("node.json");
    if let Ok(data) = fs::read_to_string(&node_json) {
        if let Ok(def) = serde_json::from_str::<CustomNodeDefinition>(&data) {
            if let Some(entry) = def.extra.get("entry").and_then(|v| v.as_str()) {
                return entry.to_string();
            }
        }
    }
    "script.js".to_string()
}

/// Source + clamped limits + capability grants for a script node, read off disk.
struct PreparedScript {
    source: String,
    timeout_ms: u64,
    memory_bytes: usize,
    network: hive_sandbox::NetworkGrant,
    credentials: Vec<String>,
}

/// Read a script node's source, limits, and grants off disk. Enforces kind/runtime.
fn prepare_script(
    app: &tauri::AppHandle,
    scope: &str,
    id: &str,
    workspace_path: Option<&str>,
) -> Result<PreparedScript, String> {
    let folder = custom_nodes_dir_for_scope(app, scope, workspace_path)?.join(id);
    let node_json = folder.join("node.json");
    let data = fs::read_to_string(&node_json)
        .map_err(|e| format!("Failed to read custom node definition: {}", e))?;
    let def: CustomNodeDefinition =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse node.json: {}", e))?;

    if def.kind != "script" {
        return Err("This custom node is not a script node".to_string());
    }
    let runtime_kind = def.extra.get("runtime").and_then(|v| v.as_str()).unwrap_or("js");
    if runtime_kind != "js" {
        return Err(format!("Unsupported script runtime: {}", runtime_kind));
    }

    let entry = def
        .extra
        .get("entry")
        .and_then(|v| v.as_str())
        .unwrap_or("script.js");
    let source = fs::read_to_string(folder.join(entry))
        .map_err(|e| format!("Failed to read script source ({}): {}", entry, e))?;
    if source.len() > hive_sandbox::MAX_SOURCE_BYTES {
        return Err(format!(
            "Script source exceeds {} bytes",
            hive_sandbox::MAX_SOURCE_BYTES
        ));
    }

    let limits: Option<ScriptLimitsRaw> = def
        .extra
        .get("limits")
        .and_then(|v| serde_json::from_value(v.clone()).ok());
    let timeout_ms = hive_sandbox::clamp_timeout_ms(
        limits
            .as_ref()
            .and_then(|l| l.timeout_ms)
            .unwrap_or(hive_sandbox::DEFAULT_TIMEOUT_MS),
    );
    let memory_bytes = hive_sandbox::clamp_memory_bytes(
        limits
            .as_ref()
            .and_then(|l| l.memory_bytes)
            .unwrap_or(hive_sandbox::DEFAULT_MEMORY_BYTES),
    );

    // Network grant (default: disabled). Credentials: ids the script may inject.
    let network = def
        .extra
        .get("network")
        .and_then(|v| {
            let mode = v.get("mode").and_then(|m| m.as_str()).unwrap_or("none").to_string();
            let allow = v
                .get("allow")
                .and_then(|a| a.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            Some(hive_sandbox::NetworkGrant { mode, allow })
        })
        .unwrap_or_default();
    let credentials: Vec<String> = def
        .extra
        .get("credentials")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default();

    Ok(PreparedScript {
        source,
        timeout_ms,
        memory_bytes,
        network,
        credentials,
    })
}

#[tauri::command]
pub async fn run_script(
    app: tauri::AppHandle,
    scope: String,
    id: String,
    workspace_path: Option<String>,
    input: serde_json::Value,
    config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let prepared = prepare_script(&app, &scope, &id, workspace_path.as_deref())?;
    let input_json = serde_json::to_string(&input).map_err(|e| e.to_string())?;
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;

    let resolver: std::sync::Arc<dyn hive_sandbox::CredentialResolver> =
        std::sync::Arc::new(VaultResolver {
            app: app.clone(),
            workspace_path: workspace_path.clone(),
        });
    let fetch_env = hive_sandbox::FetchEnv {
        resolver: Some(resolver),
        network: prepared.network,
        credentials: prepared.credentials,
    };

    tokio::task::spawn_blocking(move || {
        hive_sandbox::run_quickjs(
            &prepared.source,
            &input_json,
            &config_json,
            prepared.timeout_ms,
            prepared.memory_bytes,
            fetch_env,
        )
    })
    .await
    .map_err(|e| format!("Script task failed: {}", e))?
}

/// Ensure the node's script file exists (seeding a starter template if absent), then
/// reveal it in the OS file manager so the user can open it in their own editor. We
/// deliberately reveal rather than launch: on Windows the default handler for `.js`
/// would *execute* the file via Windows Script Host.
#[tauri::command]
pub fn open_custom_node_script(
    app: tauri::AppHandle,
    scope: String,
    id: String,
    workspace_path: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let folder = custom_nodes_dir_for_scope(&app, &scope, workspace_path.as_deref())?.join(&id);
    fs::create_dir_all(&folder)
        .map_err(|e| format!("Failed to create custom-node folder: {}", e))?;

    let entry = script_entry_for(&folder);
    let script_path = folder.join(&entry);
    if !script_path.exists() {
        write_atomic(&script_path, hive_sandbox::STARTER_SCRIPT.as_bytes())?;
    }

    app.opener()
        .reveal_item_in_dir(&script_path)
        .map_err(|e| format!("Failed to reveal script file: {}", e))?;
    Ok(())
}

// Sandbox unit tests (QuickJS execution + SSRF guards + credential gating) live in the
// `hive-sandbox` crate and run natively everywhere: `cargo test -p hive-sandbox`.
