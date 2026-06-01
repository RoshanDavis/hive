//! Outbound LLM chat dispatch.
//!
//! Lives in Rust so API keys never reach the renderer and so the shared HTTP
//! client can enforce stall timeouts that protect the run loop. `llm_chat`
//! is a thin polymorphic switch over `provider`; per-provider request shapes
//! stay inline until a 5th provider arrives (the trait extraction was
//! explicitly deferred in the refactor plan).

use crate::commands::credentials::resolve_credential_values;
use crate::models::{OllamaMessage, OllamaOptions, OllamaRequest, OllamaResponse};

/// Shared HTTP client for outbound LLM calls. Explicit connect + overall timeouts so a
/// stalled or unresponsive provider can't hang the Tauri command (and the run loop) forever.
fn llm_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
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

    let client = llm_http_client()?;
    let res = client
        .post(format!("{}/api/chat", ollama_url))
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to Ollama: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Ollama returned error status ({}): {}", status, err_text));
    }

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
    credential_id: Option<String>,
    credential_scope: Option<String>,
    workspace_path: Option<String>,
    model_name: String,
    messages: Vec<OllamaMessage>,
    temperature: f64,
    max_tokens: u32,
) -> Result<String, String> {
    // Rust-side credential resolution: if a credentialId is provided, look it up
    // in the appropriate vault and pull base_url/api_key from the stored values.
    // The plaintext secret never crosses back into the renderer. Ollama (local)
    // doesn't need a credential, so this is None for that path.
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
            .map(|s| s.to_string());
        let resolved_url = values
            .get("baseURL")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or(base_url);
        (resolved_key, resolved_url)
    } else {
        (None, base_url)
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
        let client = llm_http_client()?;
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

        let client = llm_http_client()?;
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
