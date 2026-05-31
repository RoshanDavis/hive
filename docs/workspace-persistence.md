# Workspace Persistence (`.hive/`)

> **📌 Living document — current design, not a contract.** Describes the *intended* design as of **2026-05-31** (post-refactor pass, `commands.rs` split by domain). The code is the source of truth: **if this doc and the code disagree, trust the code and fix the doc.** Detect drift by diffing the paths under [Key files](#key-files) since the verified commit, e.g. `git log --oneline <verified>..HEAD -- src-tauri/src/commands/workspace.rs src-tauri/src/utils.rs src/hooks/useWorkspaceSpaces.ts`.

A "workspace" is a user-chosen folder on disk. Hive keeps a tiny app-level registry of where workspaces are, and stores everything else *inside* each workspace under `.hive/`. All disk writes are crash-safe.

## Two storage locations

1. **App-data registry** — `workspaces.json` in Tauri's `app_data_dir` (per `read_workspaces`/`write_workspaces` in [utils.rs](../src-tauri/src/utils.rs)). It only stores `{ name, path }` pointers. `is_initialized` is recomputed on read by checking whether `<path>/.hive` exists.
2. **The workspace folder** — everything substantive lives under `<workspace>/.hive/`.

Also at app-data scope (shared across workspaces): the global credential vault, global node defaults, and global custom nodes — see [credential-vault.md](credential-vault.md), [node-defaults.md](node-defaults.md), [custom-nodes-design.md](custom-nodes-design.md).

## The `.hive/` layout

```
.hive/
  config.json                       # workspace meta + spaces index + active_space
  spaces/<space_id>.json            # nodes + edges + viewport for one canvas
  storage/<space_id>/<nodeId>.json  # jsonStorage records (decoupled from the space file)
  chats/<space_id>/<nodeId>.json    # chat history (decoupled from the space file)
  credentials.vault                 # encrypted local-scope credentials
  node-defaults.json                # per-workspace node-default overrides + user models
  custom-nodes/<id>/node.json       # workspace-scoped custom node definition
  custom-nodes/<id>/script.js       # tier-3 script source
```

`init_hive_structure` creates `spaces/` and `storage/` and writes a default `config.json` + one empty `space_1.json` on first open. `config.json` is a `WorkspaceConfig { version, name, created_at, updated_at, spaces: SpaceEntry[], active_space }`.

## Why storage/chat records are decoupled

A space file is the canvas: nodes, edges, viewport. If it also held every chat message and database record it would grow unbounded and churn on every keystroke. So **`save_space` strips the heavy/dynamic fields out of nodes before writing the space file**, persisting them to their own per-node files; **`load_space` reattaches them**. This keeps space JSON small and stable across runs.

`save_space` ([commands/workspace.rs](../src-tauri/src/commands/workspace.rs)):

- `jsonStorage` nodes → `records` written to `storage/<space_id>/<nodeId>.json`, then stripped from the node.
- `chat` nodes → `messages` stripped.
- **every node** → `logs` stripped (transient per-run script output; regenerated each run, shown only in the inspector — never belongs in the space file).

`load_space` does the inverse: reads `records` back onto `jsonStorage` nodes (defaulting to `[]`), and guarantees `messages` exists on `chat` nodes so the frontend has a stable shape.

> Phase 2 (May 2026) collapsed Output node state into the single `outputEnvelope` field, so `save_space`/`load_space` no longer special-case `outputContent` — the inspector reads the response from `outputEnvelope.value`.

```text
        save_space                                   load_space
   ┌───────────────────┐                        ┌───────────────────┐
   │ node.data has      │  strip + write apart   │ read space file    │
   │ records/messages/  │ ─────────────────────▶ │ reattach records   │
   │ logs               │  storage/<sid>/<id>    │ from storage/      │
   └───────────────────┘                        └───────────────────┘
        space_<id>.json stays small                node.data rehydrated
```

## Frontend persistence flow

[src/hooks/useWorkspaceSpaces.ts](../src/hooks/useWorkspaceSpaces.ts) drives load/save from the renderer:

- **On mount:** load `config.json`, pick `active_space`, and load that space. Edges are rebuilt with their markers and their flow direction reconciled against `getConnectionBehavior` (a `bi-directional` edge whose pair only allows `one-way` is downgraded on load).
- **Auto-save:** an 800 ms debounce on `nodes`/`edges` changes calls `saveCurrentSpace`. An `isInitialLoadRef` guard suppresses saves during the initial load settle (≈500 ms) so loading a space doesn't immediately re-save it.
- **Space CRUD:** `handleAddSpace` / `handleSwitchSpace` / `handleRenameSpace` / `handleDeleteSpace` save the current space first, then mutate `config.json`. Deleting a space also removes its `chats/` and `storage/` folders.

The space file IPC shape (`SpaceData`) and the `snake_case` edge fields (`source_handle`, `target_handle`, `edge_type`) are defined in [src/types/workspace.ts](../src/types/workspace.ts) and mirrored by the Rust structs in [models.rs](../src-tauri/src/models.rs).

## Crash safety: `write_atomic` + `write_json`

Every disk write goes through `write_atomic(path, data)` ([utils.rs](../src-tauri/src/utils.rs)): write to `<file>.tmp`, then atomically `rename` over the target. A crash mid-write leaves the previous file intact, never a half-written one. For the common `serialize-then-write-atomic` chain on `serde::Serialize` values, prefer the `write_json(path, &value)` helper in the same module — it consolidates the pretty-print + map_err + write_atomic boilerplate at every call site.

## First-open initialization

`load_workspace_config` is a thin reader: missing `config.json` triggers a fresh `init_hive_structure` (creates `spaces/` + `storage/` and writes a default config + empty `space_1.json`); otherwise it parses and returns the config.

> Phase 1 (May 2026) removed the one-shot `databases/ → storage/` rename and `cleanup_unused_directories` scaffolding that earlier alpha builds carried for legacy folder layouts; current `.hive/` folders ship from `init_hive_structure` directly.

## Browser-local settings (not in `.hive/`)

A few UI preferences live in `localStorage` via [src/services/storage.ts](../src/services/storage.ts), not on disk: concurrency settings, inspector/sidebar widths, and the cut/copy/paste clipboard. These are machine-local and not part of a workspace.

## Key files

- [src-tauri/src/commands/workspace.rs](../src-tauri/src/commands/workspace.rs) — `load/save_workspace_config`, `load/save/create/delete_space`, `delete_chat_history`, `delete_storage_history`, `send_notification`, workspace registry CRUD.
- [src-tauri/src/utils.rs](../src-tauri/src/utils.rs) — `write_atomic`, `write_json`, `init_hive_structure`, registry I/O.
- [src-tauri/src/models.rs](../src-tauri/src/models.rs) — `WorkspaceConfig`, `SpaceData`, `FlowNode`, `FlowEdge`.
- [src/hooks/useWorkspaceSpaces.ts](../src/hooks/useWorkspaceSpaces.ts) — load, auto-save, space CRUD.
- [src/types/workspace.ts](../src/types/workspace.ts) — renderer-side persistence types.
- [src/services/storage.ts](../src/services/storage.ts) — `localStorage`-backed UI settings.
