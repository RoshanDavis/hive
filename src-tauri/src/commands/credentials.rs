//! Encrypted credential vault IPC + shared resolution helpers.
//!
//! The vault primitives live in [`crate::vault`] (AES-256-GCM, OS-keychain
//! master key); this module is the Tauri command surface plus the small
//! helpers (`make_global_vault`, `make_local_vault`, `vault_for_scope`,
//! `resolve_credential_values`) that other domains use to look up secrets.

use crate::vault::{
    get_or_create_master_key, global_vault_path, local_vault_path, CredentialMeta,
    CredentialVault,
};

pub fn make_global_vault(app: &tauri::AppHandle) -> Result<CredentialVault, String> {
    let key = get_or_create_master_key()?;
    let path = global_vault_path(app)?;
    Ok(CredentialVault::new(path, "global", key))
}

pub fn make_local_vault(workspace_path: &str) -> Result<CredentialVault, String> {
    let key = get_or_create_master_key()?;
    Ok(CredentialVault::new(
        local_vault_path(workspace_path),
        "local",
        key,
    ))
}

// Resolves the right vault for a scope string, validating that "local" was
// given the workspace path it needs.
pub fn vault_for_scope(
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

/// Two-vault lookup with local-first fallback (or global-first if `scope_hint == "global"`).
/// Used by [`llm`](super::llm) and [`customization::run_script`](super::customization::run_script)
/// to materialize secrets server-side so plaintext never crosses back into the renderer.
pub fn resolve_credential_values(
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

    let resolved = if scope_hint == Some("global") {
        global.resolve(credential_id)?.or(try_local(&local)?)
    } else {
        try_local(&local)?.or(global.resolve(credential_id)?)
    };

    resolved.ok_or_else(|| format!("Credential not found: {}", credential_id))
}

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
    // Write to the destination first, then remove from the source. If the destination
    // write fails the source is untouched; if the source removal fails we roll the
    // destination write back. Either way the credential is never lost from both scopes.
    let entry = source
        .get_entry(&id)?
        .ok_or_else(|| format!("Credential not found in {} vault: {}", from_scope, id))?;
    let meta = entry.to_meta(&to_scope);
    dest.insert_entry(entry)?;
    if let Err(e) = source.remove(&id) {
        // Best-effort rollback so we don't leave a duplicate in both vaults.
        let _ = dest.remove(&id);
        return Err(format!("Failed to remove credential from source vault: {}", e));
    }
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
