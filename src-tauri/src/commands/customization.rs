//! Node defaults, custom-node definitions, and sandboxed scripts.
//!
//! All three concerns share the "scope = global | workspace" + disk-backed
//! definition pattern, so they live together here. Script execution itself
//! happens in the Tauri-free [`hive_sandbox`] crate — this module just reads
//! the on-disk definition (source + clamped limits + capability grants),
//! supplies a [`VaultResolver`] for credential lookup, and hands off.

use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::credentials::resolve_credential_values;
use crate::models::{CustomNodeDefinition, NodeDefaultsConfig, ToolsConfig};
use crate::utils::{
    custom_nodes_app_dir, hive_dir, node_defaults_app_file, tools_app_file, write_atomic, write_json,
};

// ─── Node defaults IPC ────────────────────────────────────────

fn read_node_defaults_file(path: &Path) -> Result<NodeDefaultsConfig, String> {
    if !path.exists() {
        return Ok(NodeDefaultsConfig::default());
    }
    let data = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read node defaults: {}", e))?;
    serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse node defaults: {}", e))
}

fn write_node_defaults_file(path: &Path, config: &NodeDefaultsConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }
    write_json(path, config)
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

// ─── Tools registry IPC ───────────────────────────────────────

fn read_tools_file(path: &Path) -> Result<ToolsConfig, String> {
    if !path.exists() {
        return Ok(ToolsConfig::default());
    }
    let data = fs::read_to_string(path).map_err(|e| format!("Failed to read tools: {}", e))?;
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse tools: {}", e))
}

fn write_tools_file(path: &Path, config: &ToolsConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }
    write_json(path, config)
}

#[tauri::command]
pub fn load_global_tools(app: tauri::AppHandle) -> Result<ToolsConfig, String> {
    read_tools_file(&tools_app_file(&app)?)
}

#[tauri::command]
pub fn save_global_tools(app: tauri::AppHandle, config: ToolsConfig) -> Result<(), String> {
    write_tools_file(&tools_app_file(&app)?, &config)
}

#[tauri::command]
pub fn load_workspace_tools(workspace_path: String) -> Result<ToolsConfig, String> {
    read_tools_file(&hive_dir(&workspace_path).join("tools.json"))
}

#[tauri::command]
pub fn save_workspace_tools(workspace_path: String, config: ToolsConfig) -> Result<(), String> {
    write_tools_file(&hive_dir(&workspace_path).join("tools.json"), &config)
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
    write_json(&path, def)
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
