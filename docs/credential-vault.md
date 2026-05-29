# Credential Vault

> **📌 Living document — current design, not a contract.** Describes the *intended* design as of **2026-05-28** (commit `c748831`). The code is the source of truth: **if this doc and the code disagree, trust the code and fix the doc.** Detect drift by diffing the paths under [Key files](#key-files) since that commit, e.g. `git log --oneline c748831..HEAD -- src-tauri/src/vault.rs`.

API keys and tokens **never live in node data and are never returned to the renderer for execution**. They're encrypted at rest and resolved server-side at the moment of the network call. This is the security backbone for LLM nodes and Tier-3 script nodes alike.

## The core invariant

> Node data stores a **`credentialId`** string, not a secret. The plaintext is decrypted in Rust at execution time, used for the outbound HTTP request, and discarded. It does not cross back over the IPC boundary into the renderer (and, for script nodes, never enters the JS heap — see [custom-nodes-design.md](custom-nodes-design.md)).

There is a separate `credential_resolve` command used by *inspector UX* (e.g. revealing a value the user is editing), but **execution paths must not use it** to fetch a key into the renderer.

## Master key

A single 32-byte AES key, generated with a CSPRNG on first launch and stored in the **OS credential manager** via the `keyring` crate:

- service `com.rosha.hive`, account `vault-master-key` (base64).
- `get_or_create_master_key()` ([vault.rs](../src-tauri/src/vault.rs)) reads it, or creates + persists it on `NoEntry`.
- **Per-machine; not portable.** Moving a workspace to another machine carries the *encrypted* vault but not the key — so credentials don't resolve there (this is the source of the "dangling credential" UX for transplanted nodes).

## Two vaults, one key

Both encrypted with the same master key, AES-256-GCM, **per-credential random 12-byte nonce**:

| Scope | Path | Shared across |
|---|---|---|
| **Global** | `app_data_dir/credentials.vault` | all workspaces on this machine |
| **Local** | `<workspace>/.hive/credentials.vault` | one workspace only |

A `CredentialVault` is `{ path, scope, master_key }`. The on-disk `VaultFile` is `{ version, credentials: CredentialEntry[] }`. Each `CredentialEntry` stores `{ id, name, schemaType, provider, nonce, encryptedValues, createdAt, updatedAt }` — the field map (e.g. `{ apiKey, baseURL }`) is JSON-serialized, AES-GCM-encrypted, and base64-encoded into `encryptedValues`.

**Metadata vs. secret.** `CredentialMeta` (returned over IPC) is the entry *without* `nonce`/`encryptedValues` — id, name, schemaType, provider, scope, timestamps. Listing credentials never exposes ciphertext or plaintext. (`list_meta_does_not_expose_plaintext` is a regression test.)

**Corrupt-file safety.** If a vault file won't parse, it's renamed to `*.vault.corrupt.<ts>.bak` and the vault starts empty rather than losing data silently. Writes go through `write_atomic` (tempfile + rename).

## IPC surface

All registered in [lib.rs](../src-tauri/src/lib.rs), implemented in [commands.rs](../src-tauri/src/commands.rs):

| Command | Purpose |
|---|---|
| `credential_list` | global metas, plus local metas if a workspace path is given |
| `credential_add` / `credential_update` / `credential_remove` | CRUD into the scope's vault |
| `credential_transfer` | move an entry between scopes (global ⇄ local) — insert into dest first, then remove from source (rollback on failure) so the credential is never lost from both vaults |
| `credential_resolve` | decrypt + return values (inspector UX only) |

`vault_for_scope(scope, workspace_path)` picks the right vault and validates that `"local"` got a workspace path.

## Resolution at execution time (local-first)

`resolve_credential_values(app, id, scope_hint, workspace_path)` is the server-side resolver. Default order is **local-first**, then global; a `scope_hint` of `"global"` flips it. It's used by:

- **`llm_chat`** — if a `credentialId` is present, it resolves and overrides `apiKey`/`baseURL` from the stored values, then makes the call. The legacy raw `apiKey` parameter is only honored when no `credentialId` is supplied (migration fallback).
- **Script nodes** — `VaultResolver` (in `commands.rs`) implements the sandbox crate's `CredentialResolver` trait, so `ctx.fetch` can inject a granted credential's key into a header without the plaintext ever entering the JS heap.

```
renderer                         Rust (commands.rs)                vault.rs
────────                         ─────────────────                ─────────
executor passes ───credentialId──▶ resolve_credential_values ───▶ load + AES-GCM decrypt
(never the secret)                 │   (local-first, then global)   │
                                   └─ uses key for outbound HTTP ◀──┘
                                      plaintext discarded; never returned
```

## Plugin-declared credential shapes

A plugin advertises what it can consume via `credentialSchemas: CredentialSchema[]` ([src/types/credentialTypes.ts](../src/types/credentialTypes.ts)). Each schema declares `type`, `provider`, and `fields` (key/label/type/required). `LLMPlugin` declares schemas for OpenAI, Anthropic, Google, and a custom OpenAI-compatible "Other". The picker filters available credentials by the schema types the inspector asks for.

## Inspector & settings UX

- [src/components/inspectors/shared/CredentialPicker.tsx](../src/components/inspectors/shared/CredentialPicker.tsx) — the standard picker. Groups by scope (🌐 Global / 📁 Workspace), shows a red "missing" banner when a referenced credential no longer resolves, and offers an inline "Add new" mini-form (defaults to local scope for privacy).
- [src/components/shared/RevealableField.tsx](../src/components/shared/RevealableField.tsx) — password input with a 👁/🙈 toggle; pair it with any secret field.
- [src/components/settings/CredentialManager.tsx](../src/components/settings/CredentialManager.tsx) — full CRUD inside `SettingsModal`. From the Dashboard only the global section shows; inside a workspace both show with transfer buttons.

## Legacy migration

[src/services/migrateLegacyCredentials.ts](../src/services/migrateLegacyCredentials.ts) runs on workspace load (via `useWorkspaceSpaces`). It moves any inline `node.data.apiKey` into the **local** vault and replaces it with a `credentialId`. Idempotent — safe to run every load.

## Adding a credential-using node

1. Declare `credentialSchemas` on the plugin.
2. Render `<CredentialPicker schemaTypes={[...]}>` in the inspector; store only `node.data.credentialId`.
3. In the executor, pass `node.data.credentialId` (+ `ctx.workspacePath`) to a Tauri command that resolves the secret server-side. **Do not** resolve-then-use in the renderer.

## Key files

- [src-tauri/src/vault.rs](../src-tauri/src/vault.rs) — `CredentialVault`, encryption, master key, corrupt-file quarantine, tests.
- [src-tauri/src/commands.rs](../src-tauri/src/commands.rs) — credential IPC + `resolve_credential_values` + `VaultResolver`.
- [src/types/credentialTypes.ts](../src/types/credentialTypes.ts) — `CredentialSchema` shape.
- [src/services/credentialService.ts](../src/services/credentialService.ts) — renderer-side service wrapper.
- [src/components/inspectors/shared/CredentialPicker.tsx](../src/components/inspectors/shared/CredentialPicker.tsx), [src/components/settings/CredentialManager.tsx](../src/components/settings/CredentialManager.tsx) — UX.
