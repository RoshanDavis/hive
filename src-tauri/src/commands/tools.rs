//! Native tool execution for the Agent node.
//!
//! Phase 1 ships three built-in native tools. Pure-compute tools (`calculator`,
//! `current_time`) run inside the audited [`hive_sandbox`] QuickJS runtime with
//! network disabled — no new dependency, and the same hard memory/time ceilings
//! the custom script nodes use. `web_search` needs network + a key, so it makes a
//! direct Brave Search call with the user's credential resolved server-side from
//! the vault (the plaintext never reaches the renderer), mirroring `llm_chat`.
//!
//! The renderer only supplies the tool id + arguments (+ an optional credential id
//! for `web_search`); which tools exist and how they run is fixed here, server-side.

use crate::commands::credentials::resolve_credential_values;

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
            tokio::task::spawn_blocking(|| {
                run_sandbox_compute("return new Date().toISOString();", serde_json::json!({}))
            })
            .await
            .map_err(|e| format!("Tool task failed: {}", e))?
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
