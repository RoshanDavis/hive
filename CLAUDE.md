# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server only (browser, no Tauri shell)
- `npm run tauri dev` — Tauri desktop app in dev (spawns Vite at port 1420, then opens the WebView2 window). This is the normal way to run the app.
- `npm run build` — type-check (`tsc`) + Vite production build into `dist/`
- `npm run tauri build` — full Tauri bundle (installers)
- No test or lint scripts are configured. Type-checking via `tsc` (as part of `build`) is the only static check.

Dev server is locked to port 1420 (`strictPort: true`) because Tauri expects it.

## Architecture

Tauri 2 desktop app. Rust backend in `src-tauri/`, React 19 + TypeScript frontend in `src/`, React Flow (`@xyflow/react`) as the visual graph canvas, Tailwind v4 for styling.

Path alias: `@/*` → `src/*` (configured in both `tsconfig.json` and `vite.config.ts`). Always use it for cross-module imports.

Deeper per-system design docs live in `docs/` (start at [docs/architecture-overview.md](docs/architecture-overview.md)): node engine, workflow execution, credential vault, workspace persistence, node defaults, custom nodes. The sections below are the terse working summary; the docs explain data flow, edge cases, and why. Each doc carries a "living document" header recording the commit it was verified against — **when you change a system, update its doc in the same change and bump that commit**, and trust the code over the prose if they ever disagree.

### Frontend: plugin-based node engine

The visual workflow editor is built around a plugin registry, not hardcoded node types. The pieces fit together like this:

- `src/engine/plugin.ts` — `NodePlugin` interface. Each plugin bundles: type id, metadata (label/icon/category/color), `defaultData`, optional React `component` (falls back to `GenericNodeShell`), optional `inspector` panel, optional `defaultsEditor` (see Node defaults below), optional `executor`, handle config, `concurrencyPool`, `canPauseWorkflow`, `skipStorageSync`, and `credentialSchemas` (see Credential vault below).
- `src/engine/pluginRegistry.ts` — singleton registry. Plugins are registered by side-effect import of `src/nodes/plugins/index.ts`; `WorkspaceEditor.tsx` imports it for that effect. Adding a new node type means: create a plugin file under `src/nodes/plugins/`, register it in `src/nodes/plugins/index.ts`, and (usually) add an inspector under `src/components/inspectors/`.
- `src/engine/index.ts` — `executeNode(type, ctx)`. Looks up the plugin's executor. Nodes without an executor (e.g. Trigger) just propagate their upstream envelope. After execution, performs **post-execution storage sync**: walks outgoing edges to `storage`-category nodes (e.g. `jsonStorage`) with write permissions and appends a record — unless the plugin sets `skipStorageSync: true` (ChatPlugin does, because it manages its own storage sync).
- `src/hooks/useWorkspaceRunner.ts` — the run loop. BFS from start nodes, skipping already-visited nodes (except `canPauseWorkflow` nodes which may re-enter as downstream receivers), updating node `status` (`executing`/`success`/`error`/`waiting`/`pending`) for UI feedback. Bi-directional edges are treated as both forward and reverse links during reachability/propagation. Storage edges (`sourceHandle === "storage"` or `targetHandle === "storage"`) are excluded from the logic flow.

### Node output envelope contract

All inter-node data passes through `NodeOutputEnvelope` (`src/engine/types.ts`): `{ value: string, metadata?, data? }`. Read upstream data via `getUpstreamNodeData` / `getUpstreamNodeEnvelope` in `src/engine/utils.ts` — they call the plugin's `getOutput` if defined, otherwise read `data.outputEnvelope`. When writing a new executor, set `outputEnvelope` (full envelope) on node data; downstream reads come through the envelope.

### Credential vault

API keys and tokens never live in node data. They're encrypted at rest in two vault files and resolved server-side at execution time.

- **Master key** — a 32-byte AES key generated on first launch and stored in the OS credential manager (`keyring` crate, service `com.rosha.hive`, account `vault-master-key`). Per-machine; not portable.
- **Two vaults, one key** — global vault at `app_data_dir/credentials.vault` (shared across workspaces); local vault at `<workspace>/.hive/credentials.vault` (workspace-only). Both AES-256-GCM with per-credential nonces. Implemented in `src-tauri/src/vault.rs`.
- **Plugin-declared shape** — a plugin advertises what credentials it can consume via `credentialSchemas: CredentialSchema[]`. Each schema declares its `type`, `provider`, and `fields` (key/label/type/required). `LLMPlugin` declares schemas for OpenAI, Anthropic, Google, and custom OpenAI-compatible providers.
- **Inspector UX** — `src/components/inspectors/shared/CredentialPicker.tsx` is the standard credential UI. It groups available credentials by scope (🌐 Global / 📁 Workspace), shows a red "missing" banner when a referenced credential no longer resolves, and offers an inline "Add new" mini-form (defaults to local scope for privacy). Pair with `src/components/shared/RevealableField.tsx` for any password input — it has a built-in 👁/🙈 toggle.
- **Settings** — `src/components/settings/CredentialManager.tsx` is the full CRUD surface. It's mounted inside `SettingsModal`; when opened from the Dashboard, only the global section shows; from a workspace, both sections show with transfer buttons.
- **Runtime resolution is Rust-side** — executors pass `credentialId` (and optionally `workspacePath`) to `api.llmChat`; Rust looks up the entry (local-first), decrypts, and uses it for the HTTP call. The plaintext never crosses back into the renderer.
- **`ExecutionContext.workspacePath` and `InspectorProps.workspacePath`** were added so executors and inspectors can hit the vault. They're threaded from `WorkspaceEditor` through `useWorkspaceRunner` and `InspectorPanel`.
- **Adding a credential-using node**: declare `credentialSchemas` on the plugin; render `<CredentialPicker schemaTypes={[...]}>` in the inspector; have the executor pass `node.data.credentialId` to the relevant Tauri command. Do **not** read decrypted values in the renderer for execution paths.

### Node defaults (global + per-workspace)

A new node starts from `plugin.defaultData`, but users can override those defaults at two scopes so repeated setup (provider/model/credential, etc.) isn't retyped per node.

- **Three-layer merge at create time** — `plugin.defaultData ← globalDefaults[type] ← workspaceDefaults[type]` (workspace wins). The merge happens in exactly one place per add path: `WorkspaceEditor.handleAddNode` and `useWorkspaceDragDrop`, both reading `getMergedOverrides(type)` from context. Changing a default only affects **newly created** nodes; existing nodes keep their data.
- **Storage** — global at `app_data_dir/node-defaults.json`; per-workspace at `<workspace>/.hive/node-defaults.json`. Shape: `{ version, defaults: Record<pluginType, Partial<data>>, models: Record<provider, ModelEntry[]> }`. Rust commands `load/save_global_node_defaults` and `load/save_workspace_node_defaults` (in `commands.rs`); a missing file returns an empty config (no migration needed).
- **Service + cache** — `src/services/nodeDefaultsService.ts` is the façade (in-memory cache, scope-aware get/set/clear, model add/remove, `getMergedOverrides`). `src/contexts/NodeDefaultsContext.tsx` wraps the workspace tree and is the **single source of truth** the add-paths read; after any edit the editor calls its `refresh()` so changes apply without reloading. The context only re-pulls global defaults on workspace (re)mount.
- **Editors** — a plugin may declare `defaultsEditor` (a lightweight `DefaultsEditorProps` component — no Run/chat/last-response UI). `LLMPlugin` uses `src/components/defaults/LLMDefaultsEditor.tsx`; plugins without one fall back to `AutoDefaultsEditor` (auto-generates inputs from `defaultData` keys). `DefaultsEditorModal` hosts the editor and persists via the service.
- **Surfaces** — global defaults are edited on the landing-page **Nodes tab** (`src/components/NodesPage.tsx`, a Dashboard nav item); workspace defaults via the **Node Defaults** section in `SettingsModal` (`src/components/settings/NodeDefaultsPanel.tsx`, which shows only overridden nodes as cards + a `+` picker). `DefaultsEditorProps.workspacePath` is `null` at global scope.
- **Model picker** — the LLM model field is a dropdown (`src/components/inspectors/shared/ModelPicker.tsx`), not free text. It groups ⭐ built-in (`src/services/builtInModels.ts`) / 🌐 global / 📁 workspace user models with an inline "Add new" + scope toggle, mirroring `CredentialPicker`. Default credentials are allowed in `LLMDefaultsEditor` (stores only `credentialId`); at global scope only global credentials are offered.
- **Shared LLM provider config** lives in `src/services/llmProviders.ts` (`ProviderType`, `PROVIDER_BASE_URL`, `PROVIDER_SCHEMA_TYPES`) — used by both `LLMInspector` and `LLMDefaultsEditor`; keep them in sync there, not duplicated.
- **Adding a defaults editor to a node type**: set `defaultsEditor` on the plugin (or rely on `AutoDefaultsEditor`). Node cards (`src/components/shared/NodeGridCard.tsx`), the dashed add card (`DashedAddCard.tsx`), the node picker popup (`NodePickerMenu.tsx`), and the ranked search (`src/utils/rankedSearch.ts`) are reusable across these surfaces.

### Custom nodes (dynamic registry)

Users can author their own node types, workspace-scoped with promote-to-global. The full design + threat model is in [docs/custom-nodes-design.md](docs/custom-nodes-design.md) — read it before touching this area. Summary:

- **One mechanism: turn on-disk definitions into registered plugins at runtime.** `src/engine/pluginRegistry.ts` is layered — built-ins register at startup; customs register via `registerCustom(plugin, scope)` / `clearCustomsByScope(scope)`, with a monotonic `version` (`subscribe`/`getVersion`) for `useSyncExternalStore`. Because the engine, palette, connectivity, and node-defaults all read the registry, once a custom node is registered everything works.
- **Two kinds** (`src/types/customNodes.ts`, discriminated by `kind`): `preset` (a saved config over a `baseType` built-in — reuses the base plugin's executor/inspector/handles, only `meta` + `defaultData` differ, **zero new code runs**) and `script` (a sandboxed user-authored JS executor).
- **Loader + lifecycle** — `src/services/customNodeLoader.ts` `synthesizePlugin(def, scope)` builds a `NodePlugin` per definition; `src/services/customNodesService.ts` + `src/contexts/CustomNodesContext.tsx` own disk/registry CRUD. `CustomNodesProvider` (mounted in `App.tsx`) loads global customs once at app start and **swaps** workspace customs on workspace enter/leave (same lifecycle as `NodeDefaultsProvider`). A `custom:<id>` reference with no definition on disk degrades to a visible placeholder (`unknownCustomPlugin.tsx`), never crashes.
- **Script nodes run in Rust, never the renderer.** The `run_script` command executes `script.js` in an isolated QuickJS runtime (`rquickjs`) with server-clamped memory/stack/time limits. The sandbox itself (QuickJS exec + gated `fetch` + SSRF guards) lives in the **Tauri-free `src-tauri/crates/sandbox` (`hive-sandbox`) crate** behind a `CredentialResolver` trait; the Tauri side implements it with `VaultResolver`. **Disk is authoritative for code AND capability grants** — `run_script` reads the source + network/credential/limit grants off disk by scope+id+workspace; the renderer only supplies per-instance `input` + `config`, so it cannot widen a script's reach.
- **Script contract (synchronous):** the source file is the body of `(ctx) => { … }` where `ctx = { input, config, log, fetch }`; the **return value** becomes the output envelope (no `setOutput`). `ctx.fetch(url, opts)` is **blocking** and gated: host must match the `network.allow` globs, private/loopback targets are blocked unless listed exactly, and the host is validated post-DNS with connection pinning (closes DNS-rebinding TOCTOU). Credentials are injected server-side by `credentialId` and never enter the JS heap.
- **Adapter + UI** — one `src/engine/ScriptExecutor.ts` implements `NodeExecutor` for every script node. `ScriptNodeInspector.tsx` provides per-instance config, run/output/logs, "Open script in editor", and a dangling-credential banner. Authoring is `src/components/customNodes/CustomNodeFormModal.tsx` (Preset|Script toggle). Surfaces mirror node-defaults: global on the Nodes tab (`NodesPage.tsx`), workspace in `SettingsModal` (`src/components/settings/CustomNodesPanel.tsx`).
- **Editor is bring-your-own** — no embedded code editor. `open_custom_node_script` seeds a starter `script.js` if missing and **reveals it in the OS file manager** (does not launch it — on Windows the default `.js` handler executes via Windows Script Host).
- **Adding to this area**: extend `synthesizePlugin` for new kinds; keep grant enforcement server-side; reuse the credential vault + concurrency governor patterns. The import/marketplace grant-consent flow is **deferred** (no import action exists yet).

### Connection rules

`src/engine/connectivity.ts` (`getConnectionBehavior`) decides edge legality and default flow direction (`one-way`, `bi-directional`, `read-only`, `write-only`, `read-write`) based on source/target node types and which handle is used. Chat ↔ LLM defaults to `bi-directional`; anything touching `jsonStorage` resolves to a database edge (read-only / write-only / read-write). New node-pair behaviors go in `CONNECTION_RULES`.

### Concurrency governor

`src/services/concurrency.ts` exposes a singleton `concurrencyGovernor`. LLM executors call `enqueue(pool, task)` to respect per-pool limits configured in Settings. Pools are `local`, `cloud`, `general`. `isLocalModel(provider, baseURL)` checks the user-configured wildcard `localPatterns` (e.g. `*localhost*`) to decide which pool a model belongs to. Settings persist in `localStorage` via `src/services/storage.ts`.

### Rust backend

`src-tauri/src/lib.rs` registers Tauri commands; their implementations live in `src-tauri/src/commands.rs`, models in `models.rs`, helpers in `utils.rs`. The frontend calls them through `src/services/api.ts` (typed `invoke` wrappers — always go through `api`, not raw `invoke`).

LLM inference is handled in Rust (`llm_chat` command) to avoid CORS and keep API keys off the renderer. It dispatches by `provider` to OpenAI-compatible, Anthropic, or Ollama HTTP shapes. Cloud providers require a `credentialId` resolved server-side from the vault; Ollama is local and unauthenticated. `ollama_chat` is an internal helper that `llm_chat` dispatches to for Ollama requests.

The Rust side is a Cargo workspace: the `hive` bin/lib plus `crates/sandbox` (`hive-sandbox`), the Tauri-free QuickJS sandbox used by `run_script` (see Custom nodes above). Keep the sandbox GUI/Tauri-free so it stays natively unit-testable — run its tests with `cargo test -p hive-sandbox`. (`cargo test` over the whole workspace drags in the GUI crate, whose bare test harness fails to load on Windows with `STATUS_ENTRYPOINT_NOT_FOUND` due to a missing Common-Controls v6 manifest; the design doc documents the manifest workaround if you ever add GUI-crate tests.)

### Workspace persistence (`.hive/` layout)

The app manages "workspaces" — user-chosen folders on disk. The app-data registry (`workspaces.json` in Tauri's `app_data_dir`) only stores `{ name, path }` pointers; everything else lives inside the workspace folder under `.hive/`:

```
.hive/
  config.json              # workspace meta + spaces index + active_space
  spaces/<space_id>.json   # nodes + edges + viewport for one canvas
  storage/<space_id>/<nodeId>.json   # jsonStorage records, decoupled from space file
  chats/<space_id>/<nodeId>.json     # chat history, decoupled from space file
  credentials.vault        # encrypted local-scope credentials (AES-256-GCM)
  node-defaults.json       # per-workspace node-default overrides + user models
  custom-nodes/<id>/node.json   # workspace-scoped custom node definition
  custom-nodes/<id>/script.js   # tier-3 script source (kept out of node.json)
```

The global credential vault lives separately at `app_data_dir/credentials.vault`. Both vault files are encrypted with the same master key from the OS keychain. Global node defaults live alongside it at `app_data_dir/node-defaults.json`, and global custom nodes at `app_data_dir/custom-nodes/<id>/` (see Node defaults and Custom nodes above).

`save_space` in `commands.rs` strips `records`/`messages`/`outputContent` out of nodes before writing the space file and persists them to their own files; `load_space` reattaches them. This keeps space JSON small and stable across runs.

All disk writes go through `write_atomic` in `utils.rs` (write-to-tempfile + rename) to avoid corruption on crash.

## Conventions

- New node type: add a plugin under `src/nodes/plugins/`, register it in `src/nodes/plugins/index.ts`, add an inspector in `src/components/inspectors/` and re-export from `inspectors/index.ts`. Use `GenericNodeShell` unless you need custom rendering.
- New executor: implement `NodeExecutor.execute(ctx)`. To read upstream input use `getUpstreamNodeEnvelope`. To write output, update node data with `outputEnvelope` (the single source of truth for downstream consumers). For LLM-style work, wrap the network call in `concurrencyGovernor.enqueue(pool, ...)`. If the node needs auth, pass `node.data.credentialId` + `ctx.workspacePath` to a Tauri command that resolves the secret server-side — never decrypt credentials in the renderer for execution.
- New Tauri command: add it in `commands.rs`, register in `lib.rs` `invoke_handler![]`, and add a typed wrapper in `src/services/api.ts`. Use `write_atomic` for disk writes.
- Node defaults: reading merged defaults at create time goes through `useNodeDefaults().getMergedOverrides` (never read the service directly in render). After editing defaults, call the context `refresh()` so changes apply without a workspace reload. A node type gets a custom defaults form via `defaultsEditor`; otherwise `AutoDefaultsEditor` handles it.
- Custom nodes: build on the dynamic registry (`registerCustom`/`synthesizePlugin`) — see `docs/custom-nodes-design.md`. For script nodes, keep code + capability grants authoritative on disk and enforce all sandbox/network/credential policy server-side in `run_script`/`hive-sandbox`; never trust the renderer for grants. Edit script source via the on-disk `script.js` + reveal-in-file-manager, not an embedded editor.
