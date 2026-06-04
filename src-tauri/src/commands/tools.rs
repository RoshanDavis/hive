//! Native tool execution for the Agent node.
//!
//! Phase 1 ships three built-in native tools. `calculator` evaluates a user
//! expression, so it runs inside the audited [`hive_sandbox`] QuickJS runtime with
//! network disabled — the same hard memory/time ceilings the custom script nodes
//! use. `current_time` is pure, deterministic, and needs a timezone database
//! (which the sandbox lacks — QuickJS `Date` can only produce UTC), so it is
//! computed directly in Rust via [`chrono`] / [`chrono_tz`]. `web_search` needs
//! network + a key, so it makes a direct Brave Search call with the user's
//! credential resolved server-side from the vault (the plaintext never reaches the
//! renderer), mirroring `llm_chat`.
//!
//! The renderer only supplies the tool id + arguments (+ an optional credential id
//! for `web_search`); which tools exist and how they run is fixed here, server-side.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use chrono_tz::Tz;
use serde_json::{json, Value};

use crate::commands::credentials::resolve_credential_values;
use crate::commands::sandbox_support::{run_sandbox_script, VaultResolver};
use crate::models::{ToolDef, ToolsConfig};
use crate::utils::{hive_dir, tools_app_file, write_atomic};

/// Time ceiling for a built-in compute tool. Generous for arithmetic / clock reads
/// while still bounding a pathological expression (the sandbox interrupts at the deadline).
const COMPUTE_TIMEOUT_MS: u64 = 2_000;

/// Run a small, fixed JS body inside the sandbox with **network disabled** and return
/// its `output.value` string. `NetworkGrant::default()` has `mode != "allowlist"`, so
/// any `ctx.fetch` is refused — these tools are pure compute.
fn run_sandbox_compute(source: &str, config: serde_json::Value) -> Result<String, String> {
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    let fetch_env = hive_sandbox::FetchEnv {
        resolver: None,
        network: hive_sandbox::NetworkGrant::default(),
        credentials: vec![],
    };
    let result = hive_sandbox::run_quickjs(
        source,
        "{\"value\":\"\"}",
        &config_json,
        COMPUTE_TIMEOUT_MS,
        hive_sandbox::DEFAULT_MEMORY_BYTES,
        fetch_env,
    )?;
    Ok(result
        .get("output")
        .and_then(|o| o.get("value"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string())
}

/// Current real-world date + time, optionally localized to a named IANA timezone
/// (e.g. `America/New_York`). Computed in Rust — **not** the QuickJS sandbox, which
/// has no timezone database and so can only emit UTC. That UTC-only limitation is
/// what pushed the model to (stale, cached) web search for "what time is it"
/// questions; with a real local clock here it answers directly. An unrecognized
/// zone returns an actionable error so the model can retry with a valid name.
fn current_time(timezone: Option<&str>) -> Result<String, String> {
    let now = Utc::now();
    match timezone.map(str::trim).filter(|s| !s.is_empty()) {
        Some(name) => {
            let tz: Tz = name.parse().map_err(|_| {
                format!(
                    "Unknown timezone '{}'. Use an IANA name like 'America/New_York', \
                     'Europe/London', or 'Asia/Tokyo'.",
                    name
                )
            })?;
            let local = now.with_timezone(&tz);
            // e.g. "It is currently 11:10:46 PM EDT on Tuesday, June 3, 2026
            //       (America/New_York, UTC-04:00)."
            Ok(format!(
                "It is currently {} ({}, UTC{}).",
                local.format("%-I:%M:%S %p %Z on %A, %B %-d, %Y"),
                name,
                local.format("%:z"),
            ))
        }
        None => Ok(format!(
            "It is currently {} (UTC). ISO 8601: {}.",
            now.format("%-I:%M:%S %p on %A, %B %-d, %Y"),
            now.format("%Y-%m-%dT%H:%M:%SZ"),
        )),
    }
}

/// Brave Search Web API. The key is resolved server-side from the vault and sent as
/// the `X-Subscription-Token` header; results are condensed into a compact text block
/// the model can read directly.
async fn brave_web_search(
    app: &tauri::AppHandle,
    query: &str,
    credential_id: Option<String>,
    credential_scope: Option<String>,
    workspace_path: Option<String>,
) -> Result<String, String> {
    let id = credential_id.filter(|s| !s.is_empty()).ok_or_else(|| {
        "web_search needs a Brave Search API key. Select a credential for it in the Agent's Tools slot."
            .to_string()
    })?;
    let values = resolve_credential_values(
        app,
        &id,
        credential_scope.as_deref(),
        workspace_path.as_deref(),
    )?;
    let key = values
        .get("apiKey")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if key.is_empty() {
        return Err("The selected web_search credential has no API key.".to_string());
    }

    let mut url = reqwest::Url::parse("https://api.search.brave.com/res/v1/web/search")
        .map_err(|e| format!("Invalid search URL: {}", e))?;
    url.query_pairs_mut()
        .append_pair("q", query)
        .append_pair("count", "5");

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let res = client
        .get(url)
        .header("X-Subscription-Token", &key)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Brave Search returned error status ({}): {}", status, body));
    }
    let resp: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse search response: {}", e))?;

    let results = resp["web"]["results"].as_array().cloned().unwrap_or_default();
    if results.is_empty() {
        return Ok("No results found.".to_string());
    }
    let mut out = String::new();
    for (i, r) in results.iter().take(5).enumerate() {
        let title = r["title"].as_str().unwrap_or("");
        let link = r["url"].as_str().unwrap_or("");
        let desc = r["description"].as_str().unwrap_or("");
        out.push_str(&format!("{}. {}\n{}\n{}\n\n", i + 1, title, link, desc));
    }
    Ok(out.trim_end().to_string())
}

/// Execute a built-in native tool by id. Returns the tool's textual result (fed back
/// to the model). Tool-internal failures return `Err` so the agent loop can surface
/// the error to the model as the tool result and let it recover.
#[tauri::command]
pub async fn run_native_tool(
    app: tauri::AppHandle,
    tool_id: String,
    arguments: serde_json::Value,
    workspace_path: Option<String>,
    credential_id: Option<String>,
    credential_scope: Option<String>,
) -> Result<String, String> {
    match tool_id.as_str() {
        "calculator" => {
            let expr = arguments
                .get("expression")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if expr.trim().is_empty() {
                return Err("calculator requires an 'expression' argument.".to_string());
            }
            tokio::task::spawn_blocking(move || {
                run_sandbox_compute(
                    "var r = eval(String(ctx.config.expression)); return String(r);",
                    serde_json::json!({ "expression": expr }),
                )
            })
            .await
            .map_err(|e| format!("Tool task failed: {}", e))?
        }
        "current_time" => {
            // Pure + instant (no blocking I/O), so compute inline rather than on a
            // blocking task. An optional IANA `timezone` localizes the result.
            let timezone = arguments.get("timezone").and_then(|v| v.as_str());
            current_time(timezone)
        }
        "web_search" => {
            let query = arguments
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if query.trim().is_empty() {
                return Err("web_search requires a 'query' argument.".to_string());
            }
            brave_web_search(&app, &query, credential_id, credential_scope, workspace_path).await
        }
        other => Err(format!("Unknown native tool: {}", other)),
    }
}

// ─── User-defined native tools (HTTP + script) ───────────────
//
// A user native tool carries its execution config on disk in the `tools.json`
// `native[]` entry (`http` or `script`). The renderer passes only the tool id + the
// model's arguments; we read the config off disk by id (local-first) — so a buggy
// renderer can't widen a tool's reach (same rule as MCP servers / script nodes).

fn read_tools_config(path: &Path) -> Option<ToolsConfig> {
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str::<ToolsConfig>(&data).ok()
}

/// Resolve a user native tool's def + the scope that holds it, local-first
/// (workspace `.hive/tools.json` shadows the global one).
fn find_native_tool(
    app: &tauri::AppHandle,
    workspace_path: Option<&str>,
    id: &str,
) -> Result<(String, ToolDef), String> {
    let find = |cfg: ToolsConfig| cfg.native.into_iter().find(|t| t.id == id);
    if let Some(wp) = workspace_path {
        if let Some(cfg) = read_tools_config(&hive_dir(wp).join("tools.json")) {
            if let Some(def) = find(cfg) {
                return Ok(("workspace".to_string(), def));
            }
        }
    }
    if let Some(cfg) = read_tools_config(&tools_app_file(app)?) {
        if let Some(def) = find(cfg) {
            return Ok(("global".to_string(), def));
        }
    }
    Err(format!("Native tool '{}' was not found on disk.", id))
}

/// Replace each `{{arg}}` in `template` with the string form of `args[arg]`.
fn substitute_template(template: &str, args: &serde_json::Map<String, Value>) -> String {
    let mut out = template.to_string();
    for (k, v) in args {
        let needle = format!("{{{{{}}}}}", k);
        let replacement = match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        out = out.replace(&needle, &replacement);
    }
    out
}

/// Execute a declarative HTTP tool. The url/headers/body templates are filled from
/// the model's arguments, the (granted) credential is injected server-side, and the
/// request goes through the shared SSRF-guarded `hive_sandbox::http_request`.
#[tauri::command]
pub async fn run_http_tool(
    app: tauri::AppHandle,
    workspace_path: Option<String>,
    id: String,
    arguments: Value,
) -> Result<String, String> {
    let (_scope, def) = find_native_tool(&app, workspace_path.as_deref(), &id)?;
    let http = def
        .http
        .ok_or_else(|| format!("Tool '{}' has no HTTP configuration.", id))?;
    let args_map = arguments.as_object().cloned().unwrap_or_default();

    let url = substitute_template(&http.url, &args_map);
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("Invalid tool URL: {}", e))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "Tool URL has no host".to_string())?
        .to_string();

    let method = http.method.unwrap_or_else(|| "GET".to_string()).to_uppercase();

    let mut headers: HashMap<String, String> = http
        .headers
        .unwrap_or_default()
        .into_iter()
        .map(|(k, v)| (k, substitute_template(&v, &args_map)))
        .collect();

    // Body: an explicit template wins; otherwise forward the args as JSON for
    // methods that take a body.
    let body = if let Some(t) = http.body_template.as_ref().filter(|t| !t.trim().is_empty()) {
        Some(substitute_template(t, &args_map))
    } else if method != "GET" && method != "HEAD" {
        Some(serde_json::to_string(&arguments).unwrap_or_else(|_| "{}".to_string()))
    } else {
        None
    };
    if body.is_some() && !headers.keys().any(|k| k.eq_ignore_ascii_case("content-type")) {
        headers.insert("Content-Type".to_string(), "application/json".to_string());
    }

    // SSRF allowlist: explicit grant, else just the URL's own host.
    let allow = http
        .allow
        .filter(|a| !a.is_empty())
        .unwrap_or_else(|| vec![host.clone()]);
    let credentials: Vec<String> = http.credential_id.clone().into_iter().collect();

    let resolver: Arc<dyn hive_sandbox::CredentialResolver> = Arc::new(VaultResolver {
        app,
        workspace_path,
    });
    let env = hive_sandbox::FetchEnv {
        resolver: Some(resolver),
        network: hive_sandbox::NetworkGrant {
            mode: "allowlist".to_string(),
            allow,
        },
        credentials,
    };

    let mut opts = serde_json::Map::new();
    opts.insert("method".to_string(), json!(method));
    if !headers.is_empty() {
        opts.insert("headers".to_string(), json!(headers));
    }
    if let Some(b) = &body {
        opts.insert("body".to_string(), json!(b));
    }
    if let Some(cred) = &http.credential_id {
        opts.insert("credentialId".to_string(), json!(cred));
        if let Some(h) = &http.credential_header {
            opts.insert("credentialHeader".to_string(), json!(h));
        }
        if let Some(p) = &http.credential_prefix {
            opts.insert("credentialPrefix".to_string(), json!(p));
        }
    }
    let opts_json = Value::Object(opts).to_string();

    // `http_request` builds its own current-thread runtime + block_on, so run it on
    // a blocking thread (never directly on the async worker).
    let deadline = Instant::now() + Duration::from_secs(30);
    let result_json = tokio::task::spawn_blocking(move || {
        hive_sandbox::http_request(&env, &url, &opts_json, deadline)
    })
    .await
    .map_err(|e| format!("HTTP tool task failed: {}", e))?;

    let v: Value = serde_json::from_str(&result_json)
        .map_err(|e| format!("Failed to parse fetch result: {}", e))?;
    if let Some(err) = v.get("__error").and_then(|e| e.as_str()) {
        return Err(format!("HTTP tool request failed: {}", err));
    }
    let status = v.get("status").and_then(|s| s.as_u64()).unwrap_or(0);
    let ok = v.get("ok").and_then(|b| b.as_bool()).unwrap_or(false);
    let resp_body = v.get("body").and_then(|b| b.as_str()).unwrap_or("");
    Ok(if ok {
        resp_body.to_string()
    } else {
        format!("HTTP {}: {}", status, resp_body)
    })
}

/// Directory holding a script tool's `script.js`, by scope. Mirrors the SKILL.md
/// layout: `<scope>/tools/<id>/`.
fn script_tool_dir(
    app: &tauri::AppHandle,
    scope: &str,
    workspace_path: Option<&str>,
    id: &str,
) -> Result<PathBuf, String> {
    match scope {
        "global" => {
            let app_data = tools_app_file(app)?
                .parent()
                .ok_or_else(|| "Could not resolve app data dir".to_string())?
                .to_path_buf();
            Ok(app_data.join("tools").join(id))
        }
        "workspace" => {
            let wp = workspace_path
                .ok_or_else(|| "Workspace scope requires workspace_path".to_string())?;
            Ok(hive_dir(wp).join("tools").join(id))
        }
        other => Err(format!("Unknown scope: {}", other)),
    }
}

/// Result of a script-tool run: the textual output handed to the model plus the
/// `ctx.log(...)` lines, so the Agent can surface them in its Logs section
/// (mirroring how script *nodes* return `{ output, logs }`).
#[derive(serde::Serialize)]
pub struct ToolScriptResult {
    pub output: String,
    pub logs: Vec<String>,
}

/// Execute a sandboxed-script tool. The JS body lives on disk at
/// `<scope>/tools/<id>/script.js`; the model's arguments arrive as `ctx.config` (and
/// `ctx.input.data`). Runs in the same audited QuickJS sandbox as custom script nodes.
#[tauri::command]
pub async fn run_tool_script(
    app: tauri::AppHandle,
    workspace_path: Option<String>,
    id: String,
    arguments: Value,
) -> Result<ToolScriptResult, String> {
    let (scope, def) = find_native_tool(&app, workspace_path.as_deref(), &id)?;
    let script = def
        .script
        .ok_or_else(|| format!("Tool '{}' has no script configuration.", id))?;
    if script.runtime.as_deref().unwrap_or("js") != "js" {
        return Err("Unsupported tool script runtime".to_string());
    }

    let entry = script.entry.clone().unwrap_or_else(|| "script.js".to_string());
    let dir = script_tool_dir(&app, &scope, workspace_path.as_deref(), &id)?;
    let source = fs::read_to_string(dir.join(&entry))
        .map_err(|e| format!("Failed to read tool script ({}): {}", entry, e))?;
    if source.len() > hive_sandbox::MAX_SOURCE_BYTES {
        return Err(format!(
            "Tool script exceeds {} bytes",
            hive_sandbox::MAX_SOURCE_BYTES
        ));
    }

    let timeout_ms = hive_sandbox::clamp_timeout_ms(
        script
            .limits
            .as_ref()
            .and_then(|l| l.timeout_ms)
            .unwrap_or(hive_sandbox::DEFAULT_TIMEOUT_MS),
    );
    let memory_bytes = hive_sandbox::clamp_memory_bytes(
        script
            .limits
            .as_ref()
            .and_then(|l| l.memory_bytes)
            .unwrap_or(hive_sandbox::DEFAULT_MEMORY_BYTES),
    );
    let network = script
        .network
        .map(|n| hive_sandbox::NetworkGrant {
            mode: n.mode,
            allow: n.allow,
        })
        .unwrap_or_default();
    let credentials = script.credentials.unwrap_or_default();

    let input = json!({ "value": "", "data": arguments.clone() });
    let result = run_sandbox_script(
        app,
        workspace_path,
        source,
        timeout_ms,
        memory_bytes,
        network,
        credentials,
        input,
        arguments,
    )
    .await?;

    // Prefer the returned envelope's `value`; fall back to the whole output blob.
    let out = result.get("output").cloned().unwrap_or(Value::Null);
    let text = out
        .get("value")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| out.to_string());
    let logs = result
        .get("logs")
        .and_then(|l| l.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    Ok(ToolScriptResult { output: text, logs })
}

/// Ensure a script tool's `script.js` exists (seeding the starter template if absent),
/// then reveal it in the OS file manager so the user can author it in their own editor
/// (BYO editor — mirrors `open_custom_node_script`).
#[tauri::command]
pub fn open_tool_script(
    app: tauri::AppHandle,
    scope: String,
    id: String,
    workspace_path: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let dir = script_tool_dir(&app, &scope, workspace_path.as_deref(), &id)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create tool dir: {}", e))?;
    let path = dir.join("script.js");
    if !path.exists() {
        write_atomic(&path, hive_sandbox::STARTER_SCRIPT.as_bytes())?;
    }
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("Failed to reveal script.js: {}", e))?;
    Ok(())
}
