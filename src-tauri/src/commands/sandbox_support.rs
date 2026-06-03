//! Shared glue for running user JS in the Tauri-free [`hive_sandbox`] QuickJS
//! runtime: the vault-backed credential resolver and a single run entry point.
//! Used by both custom script *nodes* ([`super::customization`]) and script
//! *tools* ([`super::tools`]) so the credential-injection + spawn_blocking plumbing
//! lives in exactly one place.

use std::sync::Arc;

use crate::commands::credentials::resolve_credential_values;

/// Bridges the sandbox crate's credential lookup to the Tauri vault. The plaintext is
/// resolved here, server-side, and never crosses back into the renderer or the JS heap.
pub struct VaultResolver {
    pub app: tauri::AppHandle,
    pub workspace_path: Option<String>,
}

impl hive_sandbox::CredentialResolver for VaultResolver {
    fn resolve(
        &self,
        credential_id: &str,
    ) -> Result<serde_json::Map<String, serde_json::Value>, String> {
        resolve_credential_values(&self.app, credential_id, None, self.workspace_path.as_deref())
    }
}

/// Run `source` in a fresh QuickJS sandbox on a blocking thread, with the vault
/// resolver wired in. Limits are already clamped by the caller. Returns the raw
/// `{ output, logs }` value from the runtime (callers shape it as they need).
#[allow(clippy::too_many_arguments)]
pub async fn run_sandbox_script(
    app: tauri::AppHandle,
    workspace_path: Option<String>,
    source: String,
    timeout_ms: u64,
    memory_bytes: usize,
    network: hive_sandbox::NetworkGrant,
    credentials: Vec<String>,
    input: serde_json::Value,
    config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let input_json = serde_json::to_string(&input).map_err(|e| e.to_string())?;
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;

    let resolver: Arc<dyn hive_sandbox::CredentialResolver> = Arc::new(VaultResolver {
        app,
        workspace_path,
    });
    let fetch_env = hive_sandbox::FetchEnv {
        resolver: Some(resolver),
        network,
        credentials,
    };

    tokio::task::spawn_blocking(move || {
        hive_sandbox::run_quickjs(
            &source,
            &input_json,
            &config_json,
            timeout_ms,
            memory_bytes,
            fetch_env,
        )
    })
    .await
    .map_err(|e| format!("Script task failed: {}", e))?
}
