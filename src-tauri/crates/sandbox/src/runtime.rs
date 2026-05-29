//! The isolated QuickJS runtime: hard memory/stack/time ceilings, the `ctx` bootstrap,
//! and the one-shot `run_quickjs` entry point. Network policy lives in [`crate::net`].

use crate::net::{do_fetch, FetchEnv};
use rquickjs::{CatchResultExt, Context, Function, Object, Runtime, Value};

/// Max accepted source size (read off disk by the host before calling in).
pub const MAX_SOURCE_BYTES: usize = 256 * 1024;

pub const MIN_TIMEOUT_MS: u64 = 50;
pub const DEFAULT_TIMEOUT_MS: u64 = 5_000;
pub const MAX_TIMEOUT_MS: u64 = 10_000;
pub const MIN_MEMORY_BYTES: usize = 1024 * 1024;
pub const DEFAULT_MEMORY_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_MEMORY_BYTES: usize = 64 * 1024 * 1024;
const SCRIPT_STACK_BYTES: usize = 256 * 1024;

/// Clamp a requested timeout to the hard server-side bounds.
pub fn clamp_timeout_ms(ms: u64) -> u64 {
    ms.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
}

/// Clamp a requested memory limit to the hard server-side bounds.
pub fn clamp_memory_bytes(bytes: usize) -> usize {
    bytes.clamp(MIN_MEMORY_BYTES, MAX_MEMORY_BYTES)
}

/// Starter body written when a script node has no source yet. The file IS the body
/// of `(ctx) => { ... }`.
pub const STARTER_SCRIPT: &str = r#"// Hive script node — this file is the body of (ctx) => { ... }
// ctx.input  : upstream envelope { value, metadata, data }
// ctx.config : values from this node's configSchema fields
// ctx.log(...) : append a line to the run log (shown in the inspector)
// Return a string, or an envelope object { value, metadata, data }.

ctx.log("received:", ctx.input.value);
return ctx.input.value;
"#;

/// Orchestration evaluated once per run: wraps the user function, builds `ctx`,
/// collects logs, and normalizes the return value into an envelope, returning a
/// single JSON string `{ output, logs }`.
const BOOTSTRAP: &str = r#"
globalThis.__hive_run = function (userFn, input, config) {
  var logs = [];
  var ctx = {
    input: input,
    config: config,
    log: function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        parts.push(typeof a === 'string' ? a : JSON.stringify(a));
      }
      logs.push(parts.join(' '));
    },
    // Synchronous, gated HTTP. Returns { status, ok, body, headers }; throws on a
    // network/permission error. The host enforces the allowlist + credential grants.
    fetch: function (url, options) {
      var raw = globalThis.__hive_fetch(String(url), JSON.stringify(options || {}));
      var res = JSON.parse(raw);
      if (res && res.__error) throw new Error(res.__error);
      return res;
    }
  };
  var out = userFn(ctx);
  if (out === undefined || out === null) out = { value: '' };
  else if (typeof out === 'string') out = { value: out };
  else if (typeof out !== 'object') out = { value: String(out) };
  else if (out.value === undefined) out = Object.assign({}, out, { value: '' });
  if (typeof out.value !== 'string') out.value = String(out.value);
  return JSON.stringify({ output: out, logs: logs });
};
"#;

/// Run a script in an isolated QuickJS runtime with hard memory/stack/time ceilings.
/// Returns the parsed `{ output, logs }` JSON. CPU-bound and self-contained, so the host
/// runs it on a blocking thread; the interrupt handler aborts runaway code at the
/// deadline, and the same deadline caps any `ctx.fetch` call (see [`crate::net::do_fetch`]).
pub fn run_quickjs(
    source: &str,
    input_json: &str,
    config_json: &str,
    timeout_ms: u64,
    memory_bytes: usize,
    fetch_env: FetchEnv,
) -> Result<serde_json::Value, String> {
    let rt = Runtime::new().map_err(|e| format!("Failed to create JS runtime: {}", e))?;
    rt.set_memory_limit(memory_bytes);
    rt.set_max_stack_size(SCRIPT_STACK_BYTES);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    rt.set_interrupt_handler(Some(Box::new(move || std::time::Instant::now() >= deadline)));

    let ctx = Context::full(&rt).map_err(|e| format!("Failed to create JS context: {}", e))?;

    let evaluated = ctx.with(|ctx| -> Result<String, String> {
        // Host fetch binding: all network policy is enforced inside `do_fetch`, and the
        // script's wall-clock `deadline` bounds the request timeout.
        let fetch_handler = move |url: String, opts: String| -> rquickjs::Result<String> {
            Ok(do_fetch(&fetch_env, &url, &opts, deadline))
        };
        let fetch_fn = Function::new(ctx.clone(), fetch_handler)
            .map_err(|e| format!("Failed to bind fetch host: {}", e))?;
        ctx.globals()
            .set("__hive_fetch", fetch_fn)
            .map_err(|e| format!("Failed to register fetch host: {}", e))?;

        ctx.eval::<Value, _>(BOOTSTRAP.to_string())
            .catch(&ctx)
            .map_err(|e| format!("Internal bootstrap error: {}", e))?;

        let globals = ctx.globals();
        let json: Object = globals.get("JSON").map_err(|e| e.to_string())?;
        let parse: Function = json.get("parse").map_err(|e| e.to_string())?;

        let input_val: Value = parse
            .call((input_json.to_string(),))
            .catch(&ctx)
            .map_err(|e| format!("Invalid input JSON: {}", e))?;
        let config_val: Value = parse
            .call((config_json.to_string(),))
            .catch(&ctx)
            .map_err(|e| format!("Invalid config JSON: {}", e))?;

        let wrapper = format!("(ctx) => {{\n{}\n}}", source);
        let user_fn: Function = ctx
            .eval(wrapper)
            .catch(&ctx)
            .map_err(|e| format!("Script compile error: {}", e))?;

        let run: Function = globals.get("__hive_run").map_err(|e| e.to_string())?;
        let out: String = run
            .call((user_fn, input_val, config_val))
            .catch(&ctx)
            .map_err(|e| format!("Script error: {}", e))?;
        Ok(out)
    });

    let json_out = match evaluated {
        Ok(s) => s,
        Err(e) => {
            if std::time::Instant::now() >= deadline {
                return Err(format!("Script exceeded its {}ms time limit", timeout_ms));
            }
            return Err(e);
        }
    };

    serde_json::from_str(&json_out).map_err(|e| format!("Failed to parse script result: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::net::NetworkGrant;

    fn no_net() -> FetchEnv {
        FetchEnv {
            resolver: None,
            network: NetworkGrant::default(),
            credentials: vec![],
        }
    }

    fn run(source: &str, input: serde_json::Value, config: serde_json::Value) -> serde_json::Value {
        let ij = serde_json::to_string(&input).unwrap();
        let cj = serde_json::to_string(&config).unwrap();
        run_quickjs(source, &ij, &cj, 2000, DEFAULT_MEMORY_BYTES, no_net())
            .expect("script should run")
    }

    #[test]
    fn transforms_string_input() {
        let out = run(
            "return ctx.input.value.toUpperCase();",
            serde_json::json!({ "value": "hi" }),
            serde_json::json!({}),
        );
        assert_eq!(out["output"]["value"], "HI");
    }

    #[test]
    fn collects_logs() {
        let out = run(
            "ctx.log('a', 1); ctx.log('b'); return 'x';",
            serde_json::json!({ "value": "" }),
            serde_json::json!({}),
        );
        assert_eq!(out["output"]["value"], "x");
        let logs: Vec<String> = serde_json::from_value(out["logs"].clone()).unwrap();
        assert_eq!(logs, vec!["a 1".to_string(), "b".to_string()]);
    }

    #[test]
    fn passes_config_and_returns_envelope() {
        let out = run(
            "return { value: 'ok', data: { doubled: ctx.config.n * 2 } };",
            serde_json::json!({ "value": "" }),
            serde_json::json!({ "n": 21 }),
        );
        assert_eq!(out["output"]["value"], "ok");
        assert_eq!(out["output"]["data"]["doubled"], 42);
    }

    #[test]
    fn coerces_non_string_return_to_value() {
        let out = run(
            "return 42;",
            serde_json::json!({ "value": "" }),
            serde_json::json!({}),
        );
        assert_eq!(out["output"]["value"], "42");
    }

    #[test]
    fn enforces_timeout_on_infinite_loop() {
        let err = run_quickjs(
            "while (true) {}",
            "{\"value\":\"\"}",
            "{}",
            150,
            DEFAULT_MEMORY_BYTES,
            no_net(),
        )
        .unwrap_err();
        assert!(err.contains("time limit"), "unexpected error: {}", err);
    }

    #[test]
    fn surfaces_script_errors() {
        let err = run_quickjs(
            "throw new Error('boom');",
            "{\"value\":\"\"}",
            "{}",
            2000,
            DEFAULT_MEMORY_BYTES,
            no_net(),
        )
        .unwrap_err();
        assert!(err.contains("boom"), "unexpected error: {}", err);
    }

    #[test]
    fn fetch_blocked_when_network_disabled() {
        let out = run(
            "try { ctx.fetch('https://api.github.com'); return 'no-throw'; } catch (e) { return 'blocked: ' + e.message; }",
            serde_json::json!({ "value": "" }),
            serde_json::json!({}),
        );
        assert!(
            out["output"]["value"].as_str().unwrap().contains("disabled"),
            "expected network-disabled error, got {:?}",
            out["output"]["value"]
        );
    }

    #[test]
    fn clamp_helpers_bound_requests() {
        assert_eq!(clamp_timeout_ms(1), MIN_TIMEOUT_MS);
        assert_eq!(clamp_timeout_ms(999_999), MAX_TIMEOUT_MS);
        assert_eq!(clamp_memory_bytes(1), MIN_MEMORY_BYTES);
        assert_eq!(clamp_memory_bytes(usize::MAX), MAX_MEMORY_BYTES);
    }
}
