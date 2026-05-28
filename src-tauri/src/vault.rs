use std::fs;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use keyring::Entry;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::utils::{now_iso, write_atomic};

const KEYRING_SERVICE: &str = "com.rosha.hive";
const KEYRING_ACCOUNT: &str = "vault-master-key";
const VAULT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialEntry {
    pub id: String,
    pub name: String,
    #[serde(rename = "schemaType")]
    pub schema_type: String,
    pub provider: String,
    pub nonce: String,
    #[serde(rename = "encryptedValues")]
    pub encrypted_values: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

impl CredentialEntry {
    /// Project an encrypted entry to the public metadata shape returned over IPC.
    /// The scope is supplied by the vault, since entries don't know which file they live in.
    pub fn to_meta(&self, scope: &str) -> CredentialMeta {
        CredentialMeta {
            id: self.id.clone(),
            name: self.name.clone(),
            schema_type: self.schema_type.clone(),
            provider: self.provider.clone(),
            scope: scope.to_string(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialMeta {
    pub id: String,
    pub name: String,
    #[serde(rename = "schemaType")]
    pub schema_type: String,
    pub provider: String,
    pub scope: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VaultFile {
    version: u32,
    credentials: Vec<CredentialEntry>,
}

impl Default for VaultFile {
    fn default() -> Self {
        Self {
            version: VAULT_VERSION,
            credentials: Vec::new(),
        }
    }
}

pub struct CredentialVault {
    path: PathBuf,
    scope: String,
    master_key: [u8; 32],
}

impl CredentialVault {
    pub fn new(path: PathBuf, scope: impl Into<String>, master_key: [u8; 32]) -> Self {
        Self {
            path,
            scope: scope.into(),
            master_key,
        }
    }

    fn load(&self) -> Result<VaultFile, String> {
        if !self.path.exists() {
            return Ok(VaultFile::default());
        }
        let data = fs::read_to_string(&self.path)
            .map_err(|e| format!("Failed to read vault: {}", e))?;
        match serde_json::from_str::<VaultFile>(&data) {
            Ok(v) => Ok(v),
            Err(e) => {
                // Quarantine the corrupt file so the user doesn't silently lose entries.
                let backup = self
                    .path
                    .with_extension(format!("vault.corrupt.{}.bak", now_iso()));
                let _ = fs::rename(&self.path, &backup);
                eprintln!(
                    "Vault file at {:?} was unreadable ({}); quarantined to {:?}",
                    self.path, e, backup
                );
                Ok(VaultFile::default())
            }
        }
    }

    fn save(&self, vault: &VaultFile) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create vault directory: {}", e))?;
        }
        let json = serde_json::to_string_pretty(vault)
            .map_err(|e| format!("Failed to serialize vault: {}", e))?;
        write_atomic(&self.path, json.as_bytes())
    }

    fn cipher(&self) -> Aes256Gcm {
        let key = Key::<Aes256Gcm>::from_slice(&self.master_key);
        Aes256Gcm::new(key)
    }

    fn encrypt_values(
        &self,
        values: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<(String, String), String> {
        let plaintext = serde_json::to_vec(values)
            .map_err(|e| format!("Failed to serialize credential values: {}", e))?;

        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ct = self
            .cipher()
            .encrypt(nonce, plaintext.as_ref())
            .map_err(|e| format!("Encryption failed: {}", e))?;

        Ok((B64.encode(nonce_bytes), B64.encode(ct)))
    }

    fn decrypt_values(
        &self,
        nonce_b64: &str,
        ct_b64: &str,
    ) -> Result<serde_json::Map<String, serde_json::Value>, String> {
        let nonce_bytes = B64
            .decode(nonce_b64)
            .map_err(|e| format!("Invalid nonce encoding: {}", e))?;
        let ct = B64
            .decode(ct_b64)
            .map_err(|e| format!("Invalid ciphertext encoding: {}", e))?;
        if nonce_bytes.len() != 12 {
            return Err(format!(
                "Invalid nonce length: {} (expected 12)",
                nonce_bytes.len()
            ));
        }
        let nonce = Nonce::from_slice(&nonce_bytes);
        let plaintext = self
            .cipher()
            .decrypt(nonce, ct.as_ref())
            .map_err(|e| format!("Decryption failed (wrong key or tampered data): {}", e))?;
        let values: serde_json::Map<String, serde_json::Value> = serde_json::from_slice(&plaintext)
            .map_err(|e| format!("Failed to parse decrypted values: {}", e))?;
        Ok(values)
    }

    pub fn list_meta(&self) -> Result<Vec<CredentialMeta>, String> {
        let vault = self.load()?;
        Ok(vault.credentials.iter().map(|c| c.to_meta(&self.scope)).collect())
    }

    pub fn add(
        &self,
        name: String,
        schema_type: String,
        provider: String,
        values: serde_json::Map<String, serde_json::Value>,
    ) -> Result<CredentialMeta, String> {
        let (nonce, ciphertext) = self.encrypt_values(&values)?;
        let now = now_iso();
        let entry = CredentialEntry {
            id: Uuid::new_v4().to_string(),
            name,
            schema_type,
            provider,
            nonce,
            encrypted_values: ciphertext,
            created_at: now.clone(),
            updated_at: now,
        };
        let meta = entry.to_meta(&self.scope);
        let mut vault = self.load()?;
        vault.credentials.push(entry);
        self.save(&vault)?;
        Ok(meta)
    }

    pub fn update(
        &self,
        id: &str,
        name: Option<String>,
        values: Option<serde_json::Map<String, serde_json::Value>>,
    ) -> Result<CredentialMeta, String> {
        let mut vault = self.load()?;
        let entry = vault
            .credentials
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| format!("Credential not found in {} vault: {}", self.scope, id))?;

        if let Some(new_name) = name {
            entry.name = new_name;
        }
        if let Some(new_values) = values {
            let (nonce, ct) = self.encrypt_values(&new_values)?;
            entry.nonce = nonce;
            entry.encrypted_values = ct;
        }
        entry.updated_at = now_iso();

        let meta = entry.to_meta(&self.scope);
        self.save(&vault)?;
        Ok(meta)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut vault = self.load()?;
        let before = vault.credentials.len();
        vault.credentials.retain(|c| c.id != id);
        if vault.credentials.len() == before {
            return Err(format!(
                "Credential not found in {} vault: {}",
                self.scope, id
            ));
        }
        self.save(&vault)?;
        Ok(())
    }

    pub fn resolve(
        &self,
        id: &str,
    ) -> Result<Option<serde_json::Map<String, serde_json::Value>>, String> {
        let vault = self.load()?;
        let entry = match vault.credentials.iter().find(|c| c.id == id) {
            Some(e) => e,
            None => return Ok(None),
        };
        let values = self.decrypt_values(&entry.nonce, &entry.encrypted_values)?;
        Ok(Some(values))
    }

    pub fn take_entry(&self, id: &str) -> Result<Option<CredentialEntry>, String> {
        let mut vault = self.load()?;
        let pos = match vault.credentials.iter().position(|c| c.id == id) {
            Some(p) => p,
            None => return Ok(None),
        };
        let entry = vault.credentials.remove(pos);
        self.save(&vault)?;
        Ok(Some(entry))
    }

    pub fn insert_entry(&self, entry: CredentialEntry) -> Result<(), String> {
        let mut vault = self.load()?;
        vault.credentials.push(entry);
        self.save(&vault)
    }
}

pub fn global_vault_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(dir.join("credentials.vault"))
}

pub fn local_vault_path(workspace_path: &str) -> PathBuf {
    Path::new(workspace_path)
        .join(".hive")
        .join("credentials.vault")
}

pub fn get_or_create_master_key() -> Result<[u8; 32], String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Failed to access OS credential storage: {}", e))?;

    match entry.get_password() {
        Ok(b64) => {
            let bytes = B64
                .decode(&b64)
                .map_err(|e| format!("Stored master key is malformed: {}", e))?;
            if bytes.len() != 32 {
                return Err(format!(
                    "Stored master key has wrong length ({}), expected 32",
                    bytes.len()
                ));
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            Ok(key)
        }
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            let encoded = B64.encode(key);
            entry
                .set_password(&encoded)
                .map_err(|e| format!("Failed to save master key to OS credential storage: {}", e))?;
            Ok(key)
        }
        Err(e) => Err(format!("Failed to read master key: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn test_vault(dir: &Path) -> CredentialVault {
        let mut key = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        CredentialVault::new(dir.join("credentials.vault"), "test", key)
    }

    fn values(pairs: &[(&str, &str)]) -> serde_json::Map<String, serde_json::Value> {
        let mut m = serde_json::Map::new();
        for (k, v) in pairs {
            m.insert((*k).to_string(), serde_json::Value::String((*v).to_string()));
        }
        m
    }

    #[test]
    fn encrypts_and_decrypts_roundtrip() {
        let dir = tempdir().unwrap();
        let vault = test_vault(dir.path());
        let meta = vault
            .add(
                "test".into(),
                "openai-api-key".into(),
                "OpenAI".into(),
                values(&[("apiKey", "sk-abc")]),
            )
            .unwrap();
        let resolved = vault.resolve(&meta.id).unwrap().unwrap();
        assert_eq!(resolved.get("apiKey").unwrap().as_str().unwrap(), "sk-abc");
    }

    #[test]
    fn each_credential_gets_a_distinct_nonce() {
        let dir = tempdir().unwrap();
        let vault = test_vault(dir.path());
        let a = vault
            .add(
                "a".into(),
                "openai-api-key".into(),
                "OpenAI".into(),
                values(&[("apiKey", "same")]),
            )
            .unwrap();
        let b = vault
            .add(
                "b".into(),
                "openai-api-key".into(),
                "OpenAI".into(),
                values(&[("apiKey", "same")]),
            )
            .unwrap();
        let data = fs::read_to_string(dir.path().join("credentials.vault")).unwrap();
        let parsed: VaultFile = serde_json::from_str(&data).unwrap();
        let ea = parsed.credentials.iter().find(|c| c.id == a.id).unwrap();
        let eb = parsed.credentials.iter().find(|c| c.id == b.id).unwrap();
        assert_ne!(ea.nonce, eb.nonce);
        assert_ne!(ea.encrypted_values, eb.encrypted_values);
    }

    #[test]
    fn list_meta_does_not_expose_plaintext() {
        let dir = tempdir().unwrap();
        let vault = test_vault(dir.path());
        vault
            .add(
                "n".into(),
                "openai-api-key".into(),
                "OpenAI".into(),
                values(&[("apiKey", "sk-secret-12345")]),
            )
            .unwrap();
        let metas = vault.list_meta().unwrap();
        let serialized = serde_json::to_string(&metas).unwrap();
        assert!(!serialized.contains("sk-secret-12345"));
    }

    #[test]
    fn corrupt_file_is_quarantined_and_vault_starts_clean() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("credentials.vault");
        fs::write(&path, b"this is not json").unwrap();
        let mut key = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        let vault = CredentialVault::new(path.clone(), "test", key);
        let metas = vault.list_meta().unwrap();
        assert!(metas.is_empty());
        let entries: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert!(entries.iter().any(|n| n.contains(".corrupt.")));
    }
}
