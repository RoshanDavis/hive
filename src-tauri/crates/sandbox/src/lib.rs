//! `hive-sandbox` — the Tauri-free security core for Hive's Tier-3 custom script nodes.
//!
//! It owns the isolated QuickJS runtime ([`run_quickjs`]) with hard resource ceilings,
//! and the gated `ctx.fetch` host call with its SSRF guards. Credential resolution is
//! injected by the host through the [`CredentialResolver`] trait, so this crate depends
//! on no GUI/Tauri code — and therefore its tests run natively everywhere (no Windows
//! comctl32 manifest workaround).

mod net;
mod runtime;

pub use net::{do_fetch as http_request, CredentialResolver, FetchEnv, NetworkGrant};
pub use runtime::{
    clamp_memory_bytes, clamp_timeout_ms, run_quickjs, DEFAULT_MEMORY_BYTES, DEFAULT_TIMEOUT_MS,
    MAX_SOURCE_BYTES, STARTER_SCRIPT,
};
