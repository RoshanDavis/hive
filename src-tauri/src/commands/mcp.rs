//! MCP (Model Context Protocol) client for the Agent node.
//!
//! Connects to user-configured MCP servers via the official [`rmcp`] SDK — stdio
//! (a spawned child process) or streamable HTTP — discovers their tools
//! (`tools/list`) and invokes them (`tools/call`). The renderer only ever supplies
//! a *reference* (server id + tool name + the model's arguments): the connection
//! config (command line / url / headers) is read off disk here, server-side, from
//! the `tools.json` `mcp[]` entry — so a buggy/compromised renderer can't make us
//! spawn an arbitrary process or hit an arbitrary host (disk is authoritative for
//! grants, mirroring `run_script`).
//!
//! Live connections are cached in [`McpManager`] (Tauri managed state), keyed by
//! scope+id, and reused across calls within and across runs. A connection is
//! rebuilt when its on-disk config changes; dropping a cached handle cancels the
//! session via rmcp's internal drop guard.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use rmcp::model::CallToolRequestParams;
use rmcp::service::RunningService;
use rmcp::transport::TokioChildProcess;
use rmcp::{RoleClient, ServiceExt};

use crate::models::{McpServerConfig, ToolSchema, ToolsConfig};
use crate::utils::{hive_dir, tools_app_file};

/// How long to wait for an MCP server to spawn/connect + complete the initialize
/// handshake before giving up (so a misconfigured server can't hang the run loop).
const CONNECT_TIMEOUT_SECS: u64 = 30;

/// A live, initialized MCP client session plus the serialized config it was built
/// from (used to detect when the on-disk config changed and a reconnect is needed).
struct CachedConn {
    config_json: String,
    service: Arc<RunningService<RoleClient, ()>>,
}

/// Caches live MCP client sessions across calls (and across runs). Held in Tauri
/// managed state. Keyed by `"<workspace_path|global>|<server id>"`.
#[derive(Default)]
pub struct McpManager {
    conns: tokio::sync::Mutex<HashMap<String, CachedConn>>,
}

/// Read + parse a `tools.json` at `path`, or `None` if missing/unparseable.
fn read_tools_config(path: &Path) -> Option<ToolsConfig> {
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str::<ToolsConfig>(&data).ok()
}

/// Resolve an MCP server's connection config off disk by id, local-first
/// (workspace `.hive/tools.json` shadows the global one) — mirroring how the
/// vault resolves credentials. The renderer never supplies this.
fn load_mcp_config(
    app: &tauri::AppHandle,
    workspace_path: Option<&str>,
    id: &str,
) -> Result<McpServerConfig, String> {
    let find = |cfg: ToolsConfig| cfg.mcp.into_iter().find(|t| t.id == id).and_then(|t| t.mcp);

    if let Some(wp) = workspace_path {
        if let Some(cfg) = read_tools_config(&hive_dir(wp).join("tools.json")) {
            if let Some(mcp) = find(cfg) {
                return Ok(mcp);
            }
        }
    }
    if let Some(cfg) = read_tools_config(&tools_app_file(app)?) {
        if let Some(mcp) = find(cfg) {
            return Ok(mcp);
        }
    }
    Err(format!(
        "MCP server '{}' was not found or has no connection config on disk.",
        id
    ))
}

/// Spawn/connect the transport and run the MCP initialize handshake, bounded by
/// `CONNECT_TIMEOUT_SECS`. Both transports erase to the same `RunningService` type.
async fn connect(cfg: McpServerConfig) -> Result<RunningService<RoleClient, ()>, String> {
    let fut = async move {
        match cfg.transport.as_str() {
            "stdio" => {
                let command = cfg
                    .command
                    .filter(|c| !c.trim().is_empty())
                    .ok_or("stdio MCP server requires a command")?;
                let mut cmd = tokio::process::Command::new(command);
                if let Some(args) = &cfg.args {
                    cmd.args(args);
                }
                if let Some(env) = &cfg.env {
                    cmd.envs(env);
                }
                let transport = TokioChildProcess::new(cmd)
                    .map_err(|e| format!("failed to spawn MCP server: {}", e))?;
                ().serve(transport)
                    .await
                    .map_err(|e| format!("MCP initialize failed: {}", e))
            }
            "http" => {
                use rmcp::transport::streamable_http_client::{
                    StreamableHttpClientTransport, StreamableHttpClientTransportConfig,
                };
                let url = cfg
                    .url
                    .filter(|u| !u.trim().is_empty())
                    .ok_or("http MCP server requires a url")?;
                // Per-request auth via the `Authorization` header is the common case;
                // other static custom headers are a follow-up.
                let transport = match cfg
                    .headers
                    .as_ref()
                    .and_then(|h| h.get("Authorization").or_else(|| h.get("authorization")))
                {
                    Some(auth) => {
                        let mut config = StreamableHttpClientTransportConfig::with_uri(url);
                        config.auth_header = Some(auth.clone());
                        StreamableHttpClientTransport::from_config(config)
                    }
                    None => StreamableHttpClientTransport::from_uri(url),
                };
                ().serve(transport)
                    .await
                    .map_err(|e| format!("MCP initialize failed: {}", e))
            }
            other => Err(format!("unknown MCP transport: {}", other)),
        }
    };

    match tokio::time::timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS), fut).await {
        Ok(result) => result,
        Err(_) => Err("MCP server connection timed out".to_string()),
    }
}

/// Return a live session for `id`, connecting (and caching) on first use and
/// reconnecting if the on-disk config changed since the cached session was built.
async fn ensure_connected(
    app: &tauri::AppHandle,
    manager: &McpManager,
    workspace_path: Option<&str>,
    id: &str,
) -> Result<Arc<RunningService<RoleClient, ()>>, String> {
    let cfg = load_mcp_config(app, workspace_path, id)?;
    let config_json = serde_json::to_string(&cfg).map_err(|e| e.to_string())?;
    let key = format!("{}|{}", workspace_path.unwrap_or("<global>"), id);

    let mut conns = manager.conns.lock().await;
    if let Some(existing) = conns.get(&key) {
        if existing.config_json == config_json {
            return Ok(existing.service.clone());
        }
        // Config changed → drop the stale session (its drop guard cancels it).
        conns.remove(&key);
    }

    let service = Arc::new(connect(cfg).await?);
    conns.insert(
        key,
        CachedConn {
            config_json,
            service: service.clone(),
        },
    );
    Ok(service)
}

/// Concatenate the text blocks of a tool result into a single string the model reads.
fn flatten_content(content: &[rmcp::model::Content]) -> String {
    let mut out = String::new();
    for c in content {
        if let Some(text) = c.as_text() {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&text.text);
        }
    }
    out.trim().to_string()
}

/// Discover an MCP server's tools (`tools/list`), as provider-neutral [`ToolSchema`]s
/// the Agent loop can offer to the model (namespaced `mcp:<id>:<tool>` renderer-side).
#[tauri::command]
pub async fn mcp_list_tools(
    app: tauri::AppHandle,
    manager: tauri::State<'_, McpManager>,
    workspace_path: Option<String>,
    id: String,
) -> Result<Vec<ToolSchema>, String> {
    let service = ensure_connected(&app, &manager, workspace_path.as_deref(), &id).await?;
    let tools = service
        .list_all_tools()
        .await
        .map_err(|e| format!("tools/list failed for MCP server '{}': {}", id, e))?;
    Ok(tools
        .into_iter()
        .map(|t| ToolSchema {
            name: t.name.to_string(),
            description: t.description.map(|d| d.to_string()),
            parameters: serde_json::Value::Object((*t.input_schema).clone()),
        })
        .collect())
}

/// Invoke one tool on an MCP server (`tools/call`) and return its text result. A
/// tool that reports `is_error` becomes an `Err` so the Agent loop surfaces it to
/// the model (which can then recover), matching the native-tool contract.
#[tauri::command]
pub async fn mcp_call_tool(
    app: tauri::AppHandle,
    manager: tauri::State<'_, McpManager>,
    workspace_path: Option<String>,
    id: String,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<String, String> {
    let service = ensure_connected(&app, &manager, workspace_path.as_deref(), &id).await?;
    // `CallToolRequestParams` is #[non_exhaustive]: build via its constructor + set
    // the public `arguments` field rather than a (cross-crate) struct literal.
    let mut params = CallToolRequestParams::new(tool_name.clone());
    params.arguments = arguments.as_object().cloned();
    let result = service
        .call_tool(params)
        .await
        .map_err(|e| format!("tools/call '{}' failed: {}", tool_name, e))?;

    let text = flatten_content(&result.content);
    if result.is_error.unwrap_or(false) {
        return Err(if text.is_empty() {
            format!("MCP tool '{}' reported an error.", tool_name)
        } else {
            text
        });
    }
    Ok(if text.is_empty() {
        "(the tool returned no text output)".to_string()
    } else {
        text
    })
}
