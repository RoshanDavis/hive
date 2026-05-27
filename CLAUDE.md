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

### Frontend: plugin-based node engine

The visual workflow editor is built around a plugin registry, not hardcoded node types. The pieces fit together like this:

- `src/engine/plugin.ts` — `NodePlugin` interface. Each plugin bundles: type id, metadata (label/icon/category/color), `defaultData`, optional React `component` (falls back to `GenericNodeShell`), optional `inspector` panel, optional `executor`, handle config, `concurrencyPool`, `canPauseWorkflow`, `skipStorageSync`, and backward-compat `aliases`.
- `src/engine/pluginRegistry.ts` — singleton registry. Plugins are registered by side-effect import of `src/nodes/plugins/index.ts`; `WorkspaceEditor.tsx` imports it for that effect. Adding a new node type means: create a plugin file under `src/nodes/plugins/`, register it in `src/nodes/plugins/index.ts`, and (usually) add an inspector under `src/components/inspectors/`.
- `src/engine/index.ts` — `executeNode(type, ctx)`. Looks up the plugin's executor. Nodes without an executor (e.g. Trigger) just propagate their upstream envelope. After execution, performs **post-execution storage sync**: walks outgoing edges to `storage`-category nodes (e.g. `jsonStorage`) with write permissions and appends a record — unless the plugin sets `skipStorageSync: true` (ChatPlugin does, because it manages its own storage sync).
- `src/hooks/useWorkspaceRunner.ts` — the run loop. BFS from start nodes, skipping already-visited nodes (except `canPauseWorkflow` nodes which may re-enter as downstream receivers), updating node `status` (`executing`/`success`/`error`/`waiting`/`pending`) for UI feedback. Bi-directional edges are treated as both forward and reverse links during reachability/propagation. Storage edges (`sourceHandle === "storage"` or `targetHandle === "storage"`) are excluded from the logic flow.

### Node output envelope contract

All inter-node data passes through `NodeOutputEnvelope` (`src/engine/types.ts`): `{ value: string, metadata?, data? }`. Read upstream data via `getUpstreamNodeData` / `getUpstreamNodeEnvelope` in `src/engine/utils.ts` — they try, in order: plugin's `getOutput`, `data.outputEnvelope`, then legacy fallbacks (`lastResponse`, `outputContent`, `output`, `value`). When writing a new executor, set both `lastResponse` (string) and `outputEnvelope` (full envelope) on node data so downstream nodes work regardless of which path they read.

### Connection rules

`src/engine/connectivity.ts` (`getConnectionBehavior`) decides edge legality and default flow direction (`one-way`, `bi-directional`, `read-only`, `write-only`, `read-write`) based on source/target node types and which handle is used. Chat ↔ LLM defaults to `bi-directional`; anything touching `jsonStorage` resolves to a database edge (read-only / write-only / read-write). New node-pair behaviors go in `CONNECTION_RULES`.

### Concurrency governor

`src/services/concurrency.ts` exposes a singleton `concurrencyGovernor`. LLM executors call `enqueue(pool, task)` to respect per-pool limits configured in Settings. Pools are `local`, `cloud`, `general`; legacy names (`ollama`→`local`, `llm`→`cloud`) are auto-resolved. `isLocalModel(provider, baseURL)` checks the user-configured wildcard `localPatterns` (e.g. `*localhost*`) to decide which pool a model belongs to. Settings persist in `localStorage` via `src/services/storage.ts` (with legacy-schema migration).

### Rust backend

`src-tauri/src/lib.rs` registers Tauri commands; their implementations live in `src-tauri/src/commands.rs`, models in `models.rs`, helpers in `utils.rs`. The frontend calls them through `src/services/api.ts` (typed `invoke` wrappers — always go through `api`, not raw `invoke`).

LLM inference is handled in Rust (`llm_chat` command) to avoid CORS and keep API keys off the renderer. It dispatches by `provider` to OpenAI-compatible, Anthropic, or Ollama HTTP shapes. `ollama_chat` is the older direct path.

### Workspace persistence (`.hive/` layout)

The app manages "workspaces" — user-chosen folders on disk. The app-data registry (`workspaces.json` in Tauri's `app_data_dir`) only stores `{ name, path }` pointers; everything else lives inside the workspace folder under `.hive/`:

```
.hive/
  config.json              # workspace meta + spaces index + active_space
  spaces/<space_id>.json   # nodes + edges + viewport for one canvas
  storage/<space_id>/<nodeId>.json   # jsonStorage records, decoupled from space file
  chats/<space_id>/<nodeId>.json     # chat history, decoupled from space file
```

`save_space` in `commands.rs` strips `records`/`messages`/`outputContent` out of nodes before writing the space file and persists them to their own files; `load_space` reattaches them. This keeps space JSON small and stable across runs. `commands.rs` also auto-migrates the legacy `databases/` folder to `storage/` and cleans up legacy empty dirs (`assets/`, `agents/`, `data/`, etc.) on load.

All disk writes go through `write_atomic` in `utils.rs` (write-to-tempfile + rename) to avoid corruption on crash.

## Conventions

- New node type: add a plugin under `src/nodes/plugins/`, register it in `src/nodes/plugins/index.ts`, add an inspector in `src/components/inspectors/` and re-export from `inspectors/index.ts`. Use `GenericNodeShell` unless you need custom rendering.
- New executor: implement `NodeExecutor.execute(ctx)`. To read upstream input use `getUpstreamNodeEnvelope`. To write output, update node data with both `lastResponse` and `outputEnvelope`. For LLM-style work, wrap the network call in `concurrencyGovernor.enqueue(pool, ...)`.
- New Tauri command: add it in `commands.rs`, register in `lib.rs` `invoke_handler![]`, and add a typed wrapper in `src/services/api.ts`. Use `write_atomic` for disk writes.
- Backward compatibility: prefer adding entries to `aliases` and the legacy migration paths in `storage.ts` / `commands.rs` rather than breaking saved data.
