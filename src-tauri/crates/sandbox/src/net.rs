//! Gated HTTP for the script sandbox: the network allowlist, SSRF guards, and the
//! `do_fetch` host call. All network policy is enforced here, server-side — the JS heap
//! only ever sees the request it asked for and the response it's allowed to read.

use std::sync::Arc;

pub(crate) const MAX_FETCH_BODY_BYTES: usize = 5 * 1024 * 1024;
pub(crate) const FETCH_TIMEOUT_SECS: u64 = 15;

/// Resolves a granted credential id to its stored field map (e.g. `{ "apiKey": "…" }`).
/// Implemented by the host (Tauri vault) so this crate stays GUI-free; the plaintext is
/// fetched here and injected into the request header without ever entering the JS heap.
pub trait CredentialResolver: Send + Sync {
    fn resolve(
        &self,
        credential_id: &str,
    ) -> Result<serde_json::Map<String, serde_json::Value>, String>;
}

/// Network capability grant for a script's `ctx.fetch`. `none` blocks all requests.
#[derive(Clone, Default)]
pub struct NetworkGrant {
    pub mode: String, // "none" | "allowlist"
    pub allow: Vec<String>,
}

/// Everything `do_fetch` needs, captured into the QuickJS host closure. `resolver` is
/// `None` in unit tests (and whenever credential resolution is unavailable).
#[derive(Clone)]
pub struct FetchEnv {
    pub resolver: Option<Arc<dyn CredentialResolver>>,
    pub network: NetworkGrant,
    pub credentials: Vec<String>,
}

/// Does `host` match a single allowlist glob? Supports a bare "*" (any host) and a
/// leading "*." wildcard (e.g. "*.example.com" matches "api.example.com" and
/// "example.com"). Otherwise an exact, case-insensitive match.
pub(crate) fn host_matches_glob(host: &str, pattern: &str) -> bool {
    let host = host.to_ascii_lowercase();
    let pattern = pattern.trim().to_ascii_lowercase();
    if pattern == "*" {
        return true;
    }
    if let Some(suffix) = pattern.strip_prefix("*.") {
        return host == suffix || host.ends_with(&format!(".{}", suffix));
    }
    host == pattern
}

pub(crate) fn allow_matches(host: &str, allow: &[String]) -> bool {
    allow.iter().any(|p| host_matches_glob(host, p))
}

/// Is `host` an exact (case-insensitive) entry in the allow list? Used to require an
/// explicit opt-in before a private/loopback target is reachable.
pub(crate) fn allow_has_exact(host: &str, allow: &[String]) -> bool {
    let host = host.to_ascii_lowercase();
    allow.iter().any(|p| p.trim().to_ascii_lowercase() == host)
}

/// Is this resolved IP in a loopback / private / link-local / unspecified range (the
/// SSRF surface)? Covers IPv4 and IPv6.
pub(crate) fn is_private_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
        }
        std::net::IpAddr::V6(v6) => {
            // An IPv4-mapped address (::ffff:a.b.c.d) reaches the same host as the bare v4
            // address would, so apply the v4 rules — otherwise `::ffff:127.0.0.1` slips past.
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_private_ip(std::net::IpAddr::V4(mapped));
            }
            let seg = v6.segments();
            v6.is_loopback()
                || v6.is_unspecified()
                || (seg[0] & 0xfe00) == 0xfc00 // fc00::/7 unique-local
                || (seg[0] & 0xffc0) == 0xfe80 // fe80::/10 link-local
        }
    }
}

/// Loopback / private / link-local / unspecified targets (SSRF surface), keyed off the
/// URL host *string*: IP literals (v4 + v6) plus the `localhost` hostname. Domain names
/// that *resolve* to private IPs are caught separately at connect time (see `do_fetch`).
pub(crate) fn is_private_host(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    if h == "localhost" || h.ends_with(".localhost") {
        return true;
    }
    // IPv6 literals arrive bracketed from a URL host; tolerate both forms.
    let trimmed = h.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = trimmed.parse::<std::net::IpAddr>() {
        return is_private_ip(ip);
    }
    false
}

/// Validate a fetch target against the grant. Returns the parsed URL or an error msg.
pub(crate) fn check_fetch_target(
    network: &NetworkGrant,
    url: &str,
) -> Result<reqwest::Url, String> {
    if network.mode != "allowlist" {
        return Err("network is disabled for this node".to_string());
    }
    let parsed = reqwest::Url::parse(url).map_err(|_| "invalid URL".to_string())?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("unsupported URL scheme: {}", scheme));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "URL has no host".to_string())?
        .to_string();
    if !allow_matches(&host, &network.allow) {
        return Err(format!("host '{}' is not in this node's network allowlist", host));
    }
    if is_private_host(&host) && !allow_has_exact(&host, &network.allow) {
        return Err(format!(
            "host '{}' is a private/loopback address; list it explicitly to allow",
            host
        ));
    }
    Ok(parsed)
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FetchOptions {
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
    credential_id: Option<String>,
    credential_header: Option<String>,
    credential_prefix: Option<String>,
}

/// Perform a gated HTTP request. Always returns a JSON string: either the response
/// `{ status, ok, body, headers }` or `{ "__error": "..." }`. Credentials are
/// resolved + injected server-side; the plaintext never enters the JS heap. All
/// SSRF policy (scheme, allowlist, private-IP/DNS-rebinding) is enforced here.
///
/// Public as `hive_sandbox::http_request` so declarative HTTP *tools* (the Agent
/// node) share this one audited path with the script sandbox's `ctx.fetch`.
///
/// `deadline` is the caller's wall-clock budget (shared with the QuickJS interrupt
/// handler for scripts): the per-request timeout is capped to the remaining budget so a
/// blocking fetch can't overrun the caller's declared timeout.
pub fn do_fetch(
    env: &FetchEnv,
    url: &str,
    opts_json: &str,
    deadline: std::time::Instant,
) -> String {
    let err = |m: String| serde_json::json!({ "__error": m }).to_string();

    let opts: FetchOptions = match serde_json::from_str(opts_json) {
        Ok(o) => o,
        Err(e) => return err(format!("invalid fetch options: {}", e)),
    };
    let FetchOptions {
        method,
        headers,
        body,
        credential_id,
        credential_header,
        credential_prefix,
    } = opts;

    let target = match check_fetch_target(&env.network, url) {
        Ok(u) => u,
        Err(e) => return err(e),
    };
    let host = match target.host_str() {
        Some(h) => h.to_string(),
        None => return err("URL has no host".to_string()),
    };
    let exact_allowed = allow_has_exact(&host, &env.network.allow);

    // Per-request timeout is the smaller of the network ceiling and the script's
    // remaining wall-clock budget. If the budget is already spent, refuse.
    let remaining = deadline.saturating_duration_since(std::time::Instant::now());
    if remaining.is_zero() {
        return err("script time budget exhausted before fetch".to_string());
    }
    let req_timeout = remaining.min(std::time::Duration::from_secs(FETCH_TIMEOUT_SECS));

    let method = method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    let reqwest_method = match reqwest::Method::from_bytes(method.as_bytes()) {
        Ok(m) => m,
        Err(_) => return err(format!("invalid HTTP method: {}", method)),
    };

    // Resolve the credential synchronously, here in Rust: the script named a granted id,
    // the host resolves it from the vault and builds the auth header. The plaintext lives
    // only in this function — it never enters the JS heap.
    let auth_header: Option<(String, String)> = match &credential_id {
        Some(cred_id) => {
            if !env.credentials.contains(cred_id) {
                return err(format!("credential '{}' is not granted to this node", cred_id));
            }
            let resolver = match &env.resolver {
                Some(r) => r,
                None => return err("credential resolution is unavailable here".to_string()),
            };
            let values = match resolver.resolve(cred_id) {
                Ok(v) => v,
                Err(e) => return err(format!("failed to resolve credential: {}", e)),
            };
            let api_key = values.get("apiKey").and_then(|v| v.as_str()).unwrap_or("");
            let header_name = credential_header.unwrap_or_else(|| "Authorization".to_string());
            let prefix = credential_prefix.unwrap_or_else(|| "Bearer ".to_string());
            Some((header_name, format!("{}{}", prefix, api_key)))
        }
        None => None,
    };

    // Drive the async request to completion on a one-shot current-thread runtime. We're
    // on a spawn_blocking thread (not an async worker), so block_on here is safe — and
    // it reuses the project's proven async reqwest path.
    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => return err(format!("failed to start network runtime: {}", e)),
    };

    let outcome: Result<(u16, bool, serde_json::Map<String, serde_json::Value>, String), String> =
        rt.block_on(async move {
            // Resolve the host ourselves so we can (a) reject domains that resolve into a
            // private range (DNS-rebinding / SSRF) and (b) pin reqwest to the exact IP we
            // validated, closing the check-then-connect TOCTOU.
            let port = target.port_or_known_default().unwrap_or(0);
            let mut addrs = tokio::net::lookup_host((host.as_str(), port))
                .await
                .map_err(|e| format!("DNS resolution failed for '{}': {}", host, e))?
                .collect::<Vec<_>>();
            if addrs.is_empty() {
                return Err(format!("host '{}' did not resolve to any address", host));
            }
            if !exact_allowed {
                if let Some(bad) = addrs.iter().find(|a| is_private_ip(a.ip())) {
                    return Err(format!(
                        "host '{}' resolves to a private/loopback address ({}); refused",
                        host,
                        bad.ip()
                    ));
                }
            }
            let pinned = addrs.remove(0);

            let client = reqwest::Client::builder()
                .timeout(req_timeout)
                .resolve(&host, pinned)
                .build()
                .map_err(|e| format!("failed to build HTTP client: {}", e))?;

            let mut req = client.request(reqwest_method, target);
            if let Some(headers) = &headers {
                for (k, v) in headers {
                    req = req.header(k, v);
                }
            }
            if let Some((name, value)) = &auth_header {
                req = req.header(name, value);
            }
            if let Some(body) = body {
                req = req.body(body);
            }

            let resp = req.send().await.map_err(|e| format!("request failed: {}", e))?;
            let status = resp.status();
            let mut headers = serde_json::Map::new();
            for (name, value) in resp.headers().iter() {
                if let Ok(v) = value.to_str() {
                    headers.insert(
                        name.as_str().to_string(),
                        serde_json::Value::String(v.to_string()),
                    );
                }
            }
            let mut body = resp
                .text()
                .await
                .map_err(|e| format!("failed to read response body: {}", e))?;
            if body.len() > MAX_FETCH_BODY_BYTES {
                body = String::from_utf8_lossy(&body.as_bytes()[..MAX_FETCH_BODY_BYTES]).into_owned();
            }
            Ok((status.as_u16(), status.is_success(), headers, body))
        });

    match outcome {
        Ok((status, ok, headers, body)) => serde_json::json!({
            "status": status,
            "ok": ok,
            "headers": headers,
            "body": body,
        })
        .to_string(),
        Err(e) => err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_matching() {
        assert!(host_matches_glob("api.github.com", "api.github.com"));
        assert!(host_matches_glob("API.GitHub.com", "api.github.com"));
        assert!(host_matches_glob("api.example.com", "*.example.com"));
        assert!(host_matches_glob("example.com", "*.example.com"));
        assert!(host_matches_glob("anything.at.all", "*"));
        assert!(!host_matches_glob("evil.com", "*.example.com"));
        assert!(!host_matches_glob("notexample.com", "api.example.com"));
    }

    #[test]
    fn private_host_detection() {
        assert!(is_private_host("localhost"));
        assert!(is_private_host("db.localhost"));
        assert!(is_private_host("127.0.0.1"));
        assert!(is_private_host("10.0.0.5"));
        assert!(is_private_host("192.168.1.1"));
        assert!(is_private_host("169.254.1.1"));
        assert!(is_private_host("::1"));
        assert!(is_private_host("[::1]"));
        assert!(is_private_host("fe80::1"));
        assert!(is_private_host("fc00::1"));
        assert!(!is_private_host("api.github.com"));
        assert!(!is_private_host("8.8.8.8"));
    }

    #[test]
    fn network_disabled_blocks_all() {
        let net = NetworkGrant { mode: "none".into(), allow: vec!["*".into()] };
        assert!(check_fetch_target(&net, "https://api.github.com").is_err());
    }

    #[test]
    fn allowlist_gates_host() {
        let net = NetworkGrant {
            mode: "allowlist".into(),
            allow: vec!["*.github.com".into()],
        };
        assert!(check_fetch_target(&net, "https://api.github.com/x").is_ok());
        assert!(check_fetch_target(&net, "https://evil.com").is_err());
    }

    #[test]
    fn wildcard_does_not_reach_private_targets() {
        // "*" allows public hosts but must NOT reach loopback unless listed exactly.
        let star = NetworkGrant { mode: "allowlist".into(), allow: vec!["*".into()] };
        assert!(check_fetch_target(&star, "http://localhost:8080").is_err());
        assert!(check_fetch_target(&star, "http://127.0.0.1").is_err());
        assert!(check_fetch_target(&star, "https://api.github.com").is_ok());

        // Explicitly listing the loopback host opts in.
        let exact = NetworkGrant {
            mode: "allowlist".into(),
            allow: vec!["localhost".into()],
        };
        assert!(check_fetch_target(&exact, "http://localhost:8080").is_ok());
    }

    #[test]
    fn rejects_non_http_schemes() {
        let net = NetworkGrant { mode: "allowlist".into(), allow: vec!["*".into()] };
        assert!(check_fetch_target(&net, "file:///etc/passwd").is_err());
        assert!(check_fetch_target(&net, "ftp://example.com").is_err());
    }

    #[test]
    fn private_ip_ranges() {
        use std::net::IpAddr;
        assert!(is_private_ip("127.0.0.1".parse::<IpAddr>().unwrap()));
        assert!(is_private_ip("10.1.2.3".parse::<IpAddr>().unwrap()));
        assert!(is_private_ip("172.16.0.1".parse::<IpAddr>().unwrap()));
        assert!(is_private_ip("169.254.10.10".parse::<IpAddr>().unwrap()));
        assert!(is_private_ip("::1".parse::<IpAddr>().unwrap()));
        // IPv4-mapped IPv6 must inherit the v4 verdict (SSRF bypass otherwise).
        assert!(is_private_ip("::ffff:127.0.0.1".parse::<IpAddr>().unwrap()));
        assert!(is_private_ip("::ffff:10.0.0.1".parse::<IpAddr>().unwrap()));
        assert!(!is_private_ip("::ffff:8.8.8.8".parse::<IpAddr>().unwrap()));
        assert!(!is_private_ip("8.8.8.8".parse::<IpAddr>().unwrap()));
        assert!(!is_private_ip("1.1.1.1".parse::<IpAddr>().unwrap()));
    }

    // ─── Credential injection (resolved synchronously, before any network) ───

    struct OkResolver;
    impl CredentialResolver for OkResolver {
        fn resolve(
            &self,
            _id: &str,
        ) -> Result<serde_json::Map<String, serde_json::Value>, String> {
            let mut m = serde_json::Map::new();
            m.insert("apiKey".into(), serde_json::Value::String("secret".into()));
            Ok(m)
        }
    }

    struct ErrResolver;
    impl CredentialResolver for ErrResolver {
        fn resolve(
            &self,
            _id: &str,
        ) -> Result<serde_json::Map<String, serde_json::Value>, String> {
            Err("vault locked".into())
        }
    }

    fn soon() -> std::time::Instant {
        std::time::Instant::now() + std::time::Duration::from_secs(2)
    }

    fn allowlisted(creds: Vec<String>, resolver: Option<Arc<dyn CredentialResolver>>) -> FetchEnv {
        FetchEnv {
            resolver,
            network: NetworkGrant { mode: "allowlist".into(), allow: vec!["api.example.com".into()] },
            credentials: creds,
        }
    }

    fn error_of(raw: &str) -> String {
        let v: serde_json::Value = serde_json::from_str(raw).unwrap();
        v.get("__error").and_then(|e| e.as_str()).unwrap_or("").to_string()
    }

    #[test]
    fn ungranted_credential_is_refused_before_network() {
        let env = allowlisted(vec![], Some(Arc::new(OkResolver)));
        let out = do_fetch(&env, "https://api.example.com", r#"{"credentialId":"x"}"#, soon());
        assert!(error_of(&out).contains("not granted"), "got: {}", out);
    }

    #[test]
    fn granted_credential_without_resolver_errors() {
        let env = allowlisted(vec!["x".into()], None);
        let out = do_fetch(&env, "https://api.example.com", r#"{"credentialId":"x"}"#, soon());
        assert!(error_of(&out).contains("unavailable"), "got: {}", out);
    }

    #[test]
    fn granted_credential_that_fails_to_resolve_errors() {
        let env = allowlisted(vec!["x".into()], Some(Arc::new(ErrResolver)));
        let out = do_fetch(&env, "https://api.example.com", r#"{"credentialId":"x"}"#, soon());
        assert!(error_of(&out).contains("vault locked"), "got: {}", out);
    }

    #[test]
    fn exhausted_time_budget_refuses_fetch() {
        let env = allowlisted(vec![], None);
        let past = std::time::Instant::now();
        let out = do_fetch(&env, "https://api.example.com", "{}", past);
        assert!(error_of(&out).contains("time budget"), "got: {}", out);
    }

    #[test]
    fn public_http_request_blocks_disabled_network() {
        // `http_request` (the public re-export of do_fetch) used by declarative HTTP
        // tools must enforce the same grants — here it refuses before any network.
        let env = FetchEnv {
            resolver: None,
            network: NetworkGrant { mode: "none".into(), allow: vec!["*".into()] },
            credentials: vec![],
        };
        let out = super::do_fetch(&env, "https://api.example.com", "{}", soon());
        assert!(error_of(&out).contains("disabled"), "got: {}", out);
    }
}
