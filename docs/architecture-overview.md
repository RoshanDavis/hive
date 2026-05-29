# Architecture Overview

> **📌 Living document — current design, not a contract.** Describes the *intended* design as of **2026-05-28** (commit `c748831`). The code is the source of truth: **if this doc and the code disagree, trust the code and fix the doc.** Detect drift by diffing the paths under [Key files](#key-files) since that commit, e.g. `git log --oneline c748831..HEAD -- src/ src-tauri/`.

This is the entry point for understanding Hive's internals. It maps the systems and links to the per-system design docs. For working conventions ("how do I add a node type?") see [CLAUDE.md](../CLAUDE.md); these docs explain *how the systems work and why*.

## About these docs

Each doc in `docs/` opens with the **living-document header** above. It records the date + commit the doc was last verified against, and names the source paths it covers. There is no automated staleness check — instead, **to find out whether a doc has drifted, diff its key files since its verified commit**:

```
git log --oneline <verified-commit>..HEAD -- <key file paths>
```

If that command shows commits, the doc may be out of date — read the changes and update the doc (and bump its header to the current commit). When you make a change that contradicts a doc, update the doc in the same PR. The header always means: *the code wins; this prose is a guide.*

## What Hive is

A [Tauri 2](https://tauri.app/) desktop app: a visual, node-graph editor for building AI workflows. Users wire nodes (LLM calls, chat, storage, triggers, notifications, and their own custom nodes) on a canvas and run them. API keys are encrypted at rest and resolved server-side, so secrets never live in the renderer.

## Three layers

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer (React 19 + TypeScript, @xyflow/react, Tailwind v4)│
│                                                               │
│  Dashboard ─▶ WorkspaceEditor ─▶ React Flow canvas            │
│      │              │                                         │
│      │              ├─ engine/      plugin registry, executor │
│      │              ├─ hooks/       run loop, persistence      │
│      │              ├─ services/    api wrappers, vault, etc.  │
│      │              └─ components/  inspectors, settings       │
└───────────────────────────┬───────────────────────────────────┘
                             │  Tauri IPC (invoke), all via src/services/api.ts
┌───────────────────────────┴───────────────────────────────────┐
│  Rust backend (src-tauri/)                                     │
│                                                                │
│  lib.rs (command registry) ─▶ commands.rs ─▶ vault.rs / utils  │
│    • workspace + space persistence (.hive/ on disk)            │
│    • credential vault (AES-256-GCM, OS-keychain master key)    │
│    • LLM inference (CORS-free, keys never returned)            │
│    • custom-node CRUD + script execution                       │
└───────────────────────────┬───────────────────────────────────┘
                             │  in-process call (hive_sandbox crate)
┌───────────────────────────┴───────────────────────────────────┐
│  hive-sandbox crate (src-tauri/crates/sandbox/)                │
│    • isolated QuickJS runtime with hard resource ceilings      │
│    • gated ctx.fetch + SSRF guards                             │
│    • Tauri-free → unit-testable natively                       │
└────────────────────────────────────────────────────────────────┘
```

**Renderer ↔ backend rule:** the frontend never calls `invoke` directly — every IPC call goes through the typed wrappers in [src/services/api.ts](../src/services/api.ts). The backend never returns decrypted secrets to the renderer.

### Security posture: why CSP is disabled

[src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) sets `security.csp: null`, i.e. no Content-Security-Policy is enforced on the WebView. This is a deliberate, documented trade-off, not an oversight:

- **No remote-content surface.** The WebView only ever loads the locally bundled app (`dist/`); there is no remote origin, and the frontend never calls `invoke` directly or evaluates server-supplied HTML. The classic CSP threat — injected remote script/styles in a page that talks to a privileged origin — does not apply.
- **Untrusted code is already isolated elsewhere.** The one place user-authored code runs is tier-3 script nodes, and those execute in the Rust-side QuickJS sandbox (`hive-sandbox`) with hard resource ceilings and SSRF-guarded `fetch` — never in the renderer. CSP would not add a meaningful layer there.
- **Cost vs. benefit.** React Flow and Tailwind v4 lean on inline styles, so a correct policy would need `style-src 'unsafe-inline'` (and careful auditing of dynamic style/`filter` usage on edges), which weakens the policy while still requiring full-UI re-testing on every dependency bump.

**Future hardening:** if the app ever loads remote content or embeds a real code editor in the renderer, enable an explicit, restrictive CSP at that point (start from `default-src 'self'` + the minimal `style-src` exceptions React Flow needs) rather than leaving it `null`.

## The central abstraction: plugins

Hive has no hardcoded node types. A `NodePlugin` ([src/engine/plugin.ts](../src/engine/plugin.ts)) bundles everything a node type needs (metadata, default data, React component, inspector, executor, handles, credential schemas, …) and is registered in a singleton registry. The engine, palette, connectivity rules, node-defaults, and custom nodes all consume the registry, so adding a node type — built-in *or* user-authored — is uniform. See [node-engine.md](node-engine.md).

## Data flow at a glance

1. A node's executor produces a **`NodeOutputEnvelope`** `{ value, metadata?, data? }` and writes it to node data.
2. Downstream nodes read it via `getUpstreamNodeEnvelope` / `getUpstreamNodeData`.
3. The **run loop** ([useWorkspaceRunner](../src/hooks/useWorkspaceRunner.ts)) walks the graph breadth-first from start nodes, driving each node's status and calling `executeNode`.
4. Edges to `storage`-category nodes are excluded from logic flow and handled by a post-execution **storage sync** step.

## System map

| System | Doc | Code |
|---|---|---|
| Plugin node engine (registry, envelope, connectivity) | [node-engine.md](node-engine.md) | `src/engine/` |
| Workflow execution (the run loop) | [workflow-execution.md](workflow-execution.md) | `src/hooks/useWorkspaceRunner.ts` |
| Credential vault | [credential-vault.md](credential-vault.md) | `src-tauri/src/vault.rs`, `commands.rs` |
| Workspace persistence (`.hive/`) | [workspace-persistence.md](workspace-persistence.md) | `src-tauri/src/commands.rs`, `utils.rs`, `src/hooks/useWorkspaceSpaces.ts` |
| Node defaults (global + workspace) | [node-defaults.md](node-defaults.md) | `src/services/nodeDefaultsService.ts` |
| Custom nodes + script sandbox | [custom-nodes-design.md](custom-nodes-design.md) | `src/services/customNode*`, `src-tauri/crates/sandbox/` |
| Concurrency governor | (in [node-engine.md](node-engine.md#concurrency-governor)) | `src/services/concurrency.ts` |

## Built-in node types

Registered by side-effect import of [src/nodes/plugins/index.ts](../src/nodes/plugins/index.ts):

- **Trigger** — a start node with no executor; just propagates an empty/upstream envelope to kick off a run.
- **LLM** — chat completion via the Rust `llm_chat` command (OpenAI-compatible, Anthropic, Ollama, Google).
- **Chat** — conversational node that can *pause* a workflow to wait for user input.
- **Output** — terminal display of an upstream value.
- **JSON Storage** — append-only record store; connected via special "storage" edges.
- **Notify** — fires an OS notification.

## Tech stack

- **Frontend:** React 19, TypeScript, `@xyflow/react` (React Flow) for the canvas, Tailwind v4. Path alias `@/*` → `src/*`.
- **Backend:** Rust, Tauri 2, `reqwest`, `tokio`, `aes-gcm`, `keyring`, `rquickjs`.
- **Build:** Vite (dev server locked to port 1420). `npm run tauri dev` is the normal way to run.
- **Tests:** Rust unit tests only (vault + sandbox). Sandbox tests: `cargo test -p hive-sandbox`. No JS test/lint scripts; `tsc` (via `npm run build`) is the static check.

## Key files

The spine of the app, for orientation and for drift-checking this doc:

- [src/App.tsx](../src/App.tsx) — router between Dashboard and WorkspaceEditor; mounts `CustomNodesProvider`.
- [src/engine/](../src/engine/) — plugin engine.
- [src/hooks/useWorkspaceRunner.ts](../src/hooks/useWorkspaceRunner.ts) — run loop.
- [src/hooks/useWorkspaceSpaces.ts](../src/hooks/useWorkspaceSpaces.ts) — load/save/auto-save.
- [src/services/api.ts](../src/services/api.ts) — the IPC boundary.
- [src-tauri/src/lib.rs](../src-tauri/src/lib.rs) — Tauri command registry.
- [src-tauri/src/commands.rs](../src-tauri/src/commands.rs) — backend command implementations.
- [src-tauri/crates/sandbox/](../src-tauri/crates/sandbox/) — script sandbox.
