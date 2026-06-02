//! Tauri command surface, split by domain.
//!
//! Each submodule owns the IPC commands for one slice of the app:
//! - [`workspace`] — workspace + space CRUD, per-node history cleanup, OS notifications.
//! - [`llm`]       — Ollama + OpenAI-compatible + Anthropic chat dispatch (plain + tool-calling).
//! - [`tools`]     — native Agent tool execution (calculator / current_time / web_search).
//! - [`credentials`] — encrypted credential vault IPC + shared resolution helpers.
//! - [`customization`] — node defaults, custom-node definitions, sandboxed scripts.
//!
//! `lib.rs::invoke_handler!` references each command at its full module path
//! (e.g. `commands::workspace::get_workspaces`) because Tauri's macro looks
//! up implementation-detail symbols generated alongside the function — a
//! `pub use` re-export here would compile but the macro can't find the
//! companion `__cmd__<name>` items, so we don't add one.

pub mod credentials;
pub mod customization;
pub mod llm;
pub mod tools;
pub mod workspace;
