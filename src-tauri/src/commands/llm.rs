//! Outbound LLM chat dispatch.
//!
//! Lives in Rust so API keys never reach the renderer and so the shared HTTP
//! client can enforce stall timeouts that protect the run loop. `llm_chat` is a
//! thin polymorphic switch over `provider` returning the assistant text;
//! `llm_chat_tools` is its tool-calling sibling — it additionally passes function
//! schemas and returns any tool-call requests the model made (provider-neutral
//! [`AgentChatResponse`]) so the renderer-side agent loop can execute tools and
//! continue the conversation. Per-provider request shapes stay inline (the trait
//! extraction was explicitly deferred until a 5th provider arrives).

use crate::commands::credentials::resolve_credential_values;
use crate::models::{
    AgentChatMessage, AgentChatResponse, OllamaMessage, OllamaOptions, OllamaRequest,
    OllamaResponse, ToolCall, ToolSchema,
};
use serde_json::{json, Value};

/// Shared HTTP client for outbound LLM calls. Explicit connect + overall timeouts so a
/// stalled or unresponsive provider can't hang the Tauri command (and the run loop) forever.
fn llm_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

/// Resolve a vault credential id (if any) into `(api_key, base_url)` server-side: the
/// credential's stored `baseURL` overrides the passed-in one, and the plaintext key
/// never crosses back into the renderer. Shared by `llm_chat` and `llm_chat_tools`.
/// Ollama (local) passes no credential, so this returns `(None, base_url)` for it.
fn resolve_key_and_url(
    app: &tauri::AppHandle,
    credential_id: Option<String>,
    credential_scope: Option<String>,
    workspace_path: Option<String>,
    base_url: Option<String>,
) -> Result<(Option<String>, Option<String>), String> {
    if let Some(id) = credential_id.as_deref() {
        let values = resolve_credential_values(
            app,
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
        Ok((resolved_key, resolved_url))
    } else {
        Ok((None, base_url))
    }
}

/// Anthropic's Messages API rejects `temperature` outside `[0, 1]` with a 400
/// (`temperature: must be <= 1`), unlike OpenAI's `[0, 2]`. The shared inspector
/// slider historically allowed up to 2, so a config saved with a higher value
/// would fail *every* Anthropic call — plain or tool-using. Clamp before dispatch
/// so those configs keep working instead of erroring.
fn clamp_anthropic_temperature(temperature: f64) -> f64 {
    temperature.clamp(0.0, 1.0)
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
    // Rust-side credential resolution: the plaintext secret never crosses back into
    // the renderer. Ollama (local) doesn't need a credential.
    let (api_key, base_url) =
        resolve_key_and_url(&app, credential_id, credential_scope, workspace_path, base_url)?;

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
            "temperature": clamp_anthropic_temperature(temperature),
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

// ─── Tool-calling (agentic) chat ─────────────────────────────
//
// Same credential resolution as `llm_chat`, but accepts function schemas and a
// richer message shape (assistant tool-call turns + tool-result messages) and
// returns the model's tool-call requests structured. The TS agent loop calls this
// once per turn, executes any requested tools, and feeds the results back.

/// OpenAI-style `tools` array (also accepted by Ollama's `/api/chat`).
fn openai_tools(tools: &[ToolSchema]) -> Vec<Value> {
    tools
        .iter()
        .map(|t| {
            json!({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description.clone().unwrap_or_default(),
                    "parameters": t.parameters,
                }
            })
        })
        .collect()
}

/// Translate neutral messages to the OpenAI chat-completions shape.
fn openai_messages(messages: &[AgentChatMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|m| {
            let mut obj = serde_json::Map::new();
            obj.insert("role".into(), json!(m.role));
            obj.insert(
                "content".into(),
                match &m.content {
                    Some(c) => json!(c),
                    None => Value::Null,
                },
            );
            if let Some(tcs) = &m.tool_calls {
                let calls: Vec<Value> = tcs
                    .iter()
                    .map(|tc| {
                        let mut call = json!({
                            "id": tc.id,
                            "type": "function",
                            "function": { "name": tc.name, "arguments": tc.arguments }
                        });
                        // Replay Google's `thought_signature` passthrough verbatim so
                        // Gemini accepts the follow-up turn; no-op for other providers
                        // (extra_content is None there).
                        if let Some(extra) = &tc.extra_content {
                            call["extra_content"] = extra.clone();
                        }
                        call
                    })
                    .collect();
                obj.insert("tool_calls".into(), json!(calls));
            }
            if let Some(id) = &m.tool_call_id {
                obj.insert("tool_call_id".into(), json!(id));
            }
            Value::Object(obj)
        })
        .collect()
}

async fn openai_chat_tools(
    url: String,
    api_key: Option<String>,
    model_name: String,
    messages: Vec<AgentChatMessage>,
    temperature: f64,
    max_tokens: u32,
    tools: Vec<ToolSchema>,
) -> Result<AgentChatResponse, String> {
    let key = api_key.unwrap_or_default();
    let client = llm_http_client()?;
    let mut req = client.post(format!("{}/chat/completions", url));
    if !key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let mut req_body = json!({
        "model": model_name,
        "messages": openai_messages(&messages),
        "temperature": temperature,
        "max_tokens": max_tokens,
    });
    if !tools.is_empty() {
        req_body["tools"] = json!(openai_tools(&tools));
    }

    let res = req
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to LLM: {}", e))?;
    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("LLM provider returned error status ({}): {}", status, err_text));
    }
    let resp: Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse response from LLM: {}", e))?;

    let message = &resp["choices"][0]["message"];
    let content = message["content"].as_str().map(|s| s.to_string());
    let mut tool_calls = Vec::new();
    if let Some(calls) = message["tool_calls"].as_array() {
        for (i, tc) in calls.iter().enumerate() {
            let id = tc["id"]
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("call_{}", i));
            let name = tc["function"]["name"].as_str().unwrap_or_default().to_string();
            let arguments = tc["function"]["arguments"].as_str().unwrap_or("{}").to_string();
            // Google (OpenAI-compat) attaches a required `thought_signature` under
            // `extra_content`; keep it verbatim so the next turn can replay it. Other
            // providers omit the field, leaving this None.
            let extra_content = tc.get("extra_content").cloned();
            if !name.is_empty() {
                tool_calls.push(ToolCall { id, name, arguments, extra_content });
            }
        }
    }
    let finish_reason = resp["choices"][0]["finish_reason"].as_str().map(|s| s.to_string());

    Ok(AgentChatResponse { content, tool_calls, finish_reason })
}

/// Coerce a tool's parameter schema into one Anthropic accepts. Anthropic 400s the
/// **entire** request if any tool's `input_schema` isn't a JSON Schema object with
/// `"type": "object"` (and it expects a `properties` map). OpenAI/Gemini/Ollama are
/// lenient, so a tool — typically discovered from an MCP server — that under-specifies
/// its schema works on those providers but sinks every Anthropic tool call. Normalize
/// to a minimally-valid object schema, preserving the tool's own `properties`/`required`.
fn anthropic_input_schema(parameters: &Value) -> Value {
    let mut schema = match parameters {
        Value::Object(map) => map.clone(),
        _ => serde_json::Map::new(),
    };
    schema.insert("type".into(), json!("object"));
    if !schema.contains_key("properties") {
        schema.insert("properties".into(), json!({}));
    }
    Value::Object(schema)
}

/// Anthropic `tools` array (uses `input_schema`, not `parameters`).
fn anthropic_tools(tools: &[ToolSchema]) -> Vec<Value> {
    tools
        .iter()
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description.clone().unwrap_or_default(),
                "input_schema": anthropic_input_schema(&t.parameters),
            })
        })
        .collect()
}

/// Flush accumulated `tool_result` blocks into a single Anthropic user message.
fn flush_tool_results(out: &mut Vec<Value>, pending: &mut Vec<Value>) {
    if !pending.is_empty() {
        out.push(json!({ "role": "user", "content": std::mem::take(pending) }));
    }
}

/// Translate neutral messages to Anthropic's shape (system handled separately).
/// Coalesces consecutive tool results into one user message and expands assistant
/// tool calls into `tool_use` blocks (arguments string → object).
///
/// NOTE — same class as Gemini's `thought_signature` (see `ToolCall::extra_content`):
/// if extended thinking is ever enabled here (sending `thinking: { type: "enabled" }`
/// in `anthropic_chat_tools`), Claude returns `thinking`/`redacted_thinking` blocks
/// whose `signature` MUST be captured and replayed — verbatim, in order, before the
/// `tool_use` blocks — on the assistant turn, or the next turn errors. We don't send
/// the `thinking` param today, so no such blocks come back and this path is complete;
/// add the capture/echo (a passthrough like `extra_content`) before turning it on.
fn anthropic_messages(messages: &[AgentChatMessage]) -> Vec<Value> {
    let mut out = Vec::new();
    let mut pending: Vec<Value> = Vec::new();
    for m in messages {
        if m.role == "tool" {
            pending.push(json!({
                "type": "tool_result",
                "tool_use_id": m.tool_call_id.clone().unwrap_or_default(),
                "content": m.content.clone().unwrap_or_default(),
            }));
            continue;
        }
        flush_tool_results(&mut out, &mut pending);
        match m.role.as_str() {
            "system" => {}
            "assistant" => {
                if let Some(tcs) = &m.tool_calls {
                    let mut blocks = Vec::new();
                    if let Some(c) = &m.content {
                        if !c.is_empty() {
                            blocks.push(json!({ "type": "text", "text": c }));
                        }
                    }
                    for tc in tcs {
                        let input: Value =
                            serde_json::from_str(&tc.arguments).unwrap_or_else(|_| json!({}));
                        blocks.push(json!({ "type": "tool_use", "id": tc.id, "name": tc.name, "input": input }));
                    }
                    out.push(json!({ "role": "assistant", "content": blocks }));
                } else {
                    out.push(json!({ "role": "assistant", "content": m.content.clone().unwrap_or_default() }));
                }
            }
            _ => {
                out.push(json!({ "role": "user", "content": m.content.clone().unwrap_or_default() }));
            }
        }
    }
    flush_tool_results(&mut out, &mut pending);
    out
}

async fn anthropic_chat_tools(
    url: String,
    api_key: Option<String>,
    model_name: String,
    messages: Vec<AgentChatMessage>,
    temperature: f64,
    max_tokens: u32,
    tools: Vec<ToolSchema>,
) -> Result<AgentChatResponse, String> {
    let key = api_key.unwrap_or_default();
    if key.is_empty() {
        return Err("Anthropic API Key is required".to_string());
    }

    let system_prompt = messages
        .iter()
        .filter(|m| m.role == "system")
        .filter_map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join("\n");

    let client = llm_http_client()?;
    let mut req_body = json!({
        "model": model_name,
        "messages": anthropic_messages(&messages),
        "temperature": clamp_anthropic_temperature(temperature),
        "max_tokens": max_tokens,
    });
    if !system_prompt.is_empty() {
        req_body["system"] = json!(system_prompt);
    }
    if !tools.is_empty() {
        req_body["tools"] = json!(anthropic_tools(&tools));
    }

    let res = client
        .post(format!("{}/v1/messages", url))
        .header("x-api-key", &key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to Anthropic: {}", e))?;
    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Anthropic returned error status ({}): {}", status, err_text));
    }
    let resp: Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse response from Anthropic: {}", e))?;

    let mut text = String::new();
    let mut tool_calls = Vec::new();
    if let Some(blocks) = resp["content"].as_array() {
        for block in blocks {
            match block["type"].as_str() {
                Some("text") => text.push_str(block["text"].as_str().unwrap_or_default()),
                Some("tool_use") => {
                    let id = block["id"].as_str().unwrap_or_default().to_string();
                    let name = block["name"].as_str().unwrap_or_default().to_string();
                    let arguments = block["input"].to_string();
                    if !name.is_empty() {
                        tool_calls.push(ToolCall { id, name, arguments, extra_content: None });
                    }
                }
                _ => {}
            }
        }
    }
    let content = if text.is_empty() { None } else { Some(text) };
    let finish_reason = resp["stop_reason"].as_str().map(|s| s.to_string());

    Ok(AgentChatResponse { content, tool_calls, finish_reason })
}

/// Translate neutral messages to Ollama's `/api/chat` shape (tool-call arguments
/// are objects there, not strings).
fn ollama_messages(messages: &[AgentChatMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|m| {
            let mut obj = serde_json::Map::new();
            obj.insert("role".into(), json!(m.role));
            obj.insert("content".into(), json!(m.content.clone().unwrap_or_default()));
            if let Some(tcs) = &m.tool_calls {
                let calls: Vec<Value> = tcs
                    .iter()
                    .map(|tc| {
                        let args: Value =
                            serde_json::from_str(&tc.arguments).unwrap_or_else(|_| json!({}));
                        json!({ "function": { "name": tc.name, "arguments": args } })
                    })
                    .collect();
                obj.insert("tool_calls".into(), json!(calls));
            }
            if let Some(name) = &m.name {
                obj.insert("tool_name".into(), json!(name));
            }
            Value::Object(obj)
        })
        .collect()
}

async fn ollama_chat_tools(
    url: String,
    model_name: String,
    messages: Vec<AgentChatMessage>,
    temperature: f64,
    max_tokens: u32,
    tools: Vec<ToolSchema>,
) -> Result<AgentChatResponse, String> {
    let client = llm_http_client()?;
    let mut req_body = json!({
        "model": model_name,
        "messages": ollama_messages(&messages),
        "stream": false,
        "options": { "temperature": temperature, "num_predict": max_tokens },
    });
    if !tools.is_empty() {
        req_body["tools"] = json!(openai_tools(&tools));
    }

    let res = client
        .post(format!("{}/api/chat", url))
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to Ollama: {}", e))?;
    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Ollama returned error status ({}): {}", status, err_text));
    }
    let resp: Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    let message = &resp["message"];
    let content = message["content"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let mut tool_calls = Vec::new();
    if let Some(calls) = message["tool_calls"].as_array() {
        for (i, tc) in calls.iter().enumerate() {
            let name = tc["function"]["name"].as_str().unwrap_or_default().to_string();
            let arguments = tc["function"]["arguments"].to_string();
            if !name.is_empty() {
                tool_calls.push(ToolCall {
                    id: format!("call_{}", i),
                    name,
                    arguments,
                    extra_content: None,
                });
            }
        }
    }
    let finish_reason = if tool_calls.is_empty() {
        resp["done_reason"].as_str().map(|s| s.to_string())
    } else {
        Some("tool_calls".to_string())
    };

    Ok(AgentChatResponse { content, tool_calls, finish_reason })
}

#[tauri::command]
pub async fn llm_chat_tools(
    app: tauri::AppHandle,
    provider: String,
    base_url: Option<String>,
    credential_id: Option<String>,
    credential_scope: Option<String>,
    workspace_path: Option<String>,
    model_name: String,
    messages: Vec<AgentChatMessage>,
    temperature: f64,
    max_tokens: u32,
    tools: Vec<ToolSchema>,
) -> Result<AgentChatResponse, String> {
    let (api_key, base_url) =
        resolve_key_and_url(&app, credential_id, credential_scope, workspace_path, base_url)?;

    let provider_lower = provider.to_lowercase();

    if provider_lower == "ollama" {
        let url = base_url.unwrap_or_else(|| "http://localhost:11434".to_string());
        ollama_chat_tools(url, model_name, messages, temperature, max_tokens, tools).await
    } else if provider_lower == "openai" || provider_lower == "other" || provider_lower == "google" {
        let url = match provider_lower.as_str() {
            "openai" => base_url.unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
            "google" => base_url.unwrap_or_else(|| "https://generativelanguage.googleapis.com/v1beta/openai".to_string()),
            _ => base_url.unwrap_or_default(),
        };
        if url.is_empty() {
            return Err("Base URL is required".to_string());
        }
        openai_chat_tools(url, api_key, model_name, messages, temperature, max_tokens, tools).await
    } else if provider_lower == "anthropic" {
        let url = base_url.unwrap_or_else(|| "https://api.anthropic.com".to_string());
        anthropic_chat_tools(url, api_key, model_name, messages, temperature, max_tokens, tools).await
    } else {
        Err(format!("Unsupported provider: {}", provider))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AgentChatMessage, ToolCall};

    fn assistant_with_call(extra_content: Option<Value>) -> AgentChatMessage {
        AgentChatMessage {
            role: "assistant".into(),
            content: None,
            tool_calls: Some(vec![ToolCall {
                id: "call_0".into(),
                name: "web_search".into(),
                arguments: "{\"query\":\"hi\"}".into(),
                extra_content,
            }]),
            tool_call_id: None,
            name: None,
        }
    }

    // Regression: Gemini (OpenAI-compat) rejects a follow-up turn whose assistant
    // tool call omits the `thought_signature` it sent back in `extra_content`.
    #[test]
    fn openai_messages_echoes_google_thought_signature() {
        let sig = json!({ "google": { "thought_signature": "sig-abc123" } });
        let out = openai_messages(&[assistant_with_call(Some(sig.clone()))]);
        assert_eq!(out[0]["tool_calls"][0]["extra_content"], sig);
        assert_eq!(out[0]["tool_calls"][0]["function"]["name"], "web_search");
    }

    // Providers that don't use it (OpenAI/Ollama/Anthropic) must not gain an
    // `extra_content` key — the wire shape stays exactly as before.
    #[test]
    fn openai_messages_omits_extra_content_when_absent() {
        let out = openai_messages(&[assistant_with_call(None)]);
        assert!(out[0]["tool_calls"][0].get("extra_content").is_none());
    }

    // Anthropic rejects temperature > 1; a config carried over from OpenAI's 0–2
    // slider must be clamped so the request doesn't 400 (in-range values untouched).
    #[test]
    fn anthropic_temperature_is_clamped_to_unit_range() {
        assert_eq!(clamp_anthropic_temperature(2.0), 1.0);
        assert_eq!(clamp_anthropic_temperature(0.7), 0.7);
        assert_eq!(clamp_anthropic_temperature(-0.5), 0.0);
    }

    // Anthropic 400s if any tool's input_schema isn't an object schema; a tool that
    // under-specifies it (e.g. from MCP) must be coerced, valid ones left intact.
    #[test]
    fn anthropic_input_schema_coerces_to_object() {
        // Missing `type` → filled in, existing properties preserved.
        let s = anthropic_input_schema(&json!({ "properties": { "q": { "type": "string" } } }));
        assert_eq!(s["type"], "object");
        assert_eq!(s["properties"]["q"]["type"], "string");
        // Non-object schema → minimal valid object schema.
        let s2 = anthropic_input_schema(&json!("nonsense"));
        assert_eq!(s2["type"], "object");
        assert_eq!(s2["properties"], json!({}));
        // Already-valid schema round-trips untouched (required preserved).
        let s3 = anthropic_input_schema(&json!({ "type": "object", "properties": {}, "required": ["x"] }));
        assert_eq!(s3["required"], json!(["x"]));
    }
}
