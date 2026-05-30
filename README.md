# Hive

A desktop app for building visual, node-based AI workflows. Wire together LLM calls, chat, storage, triggers, and your own custom nodes on a graph canvas — with API keys kept encrypted and off the renderer.

Built with [Tauri 2](https://tauri.app/) (Rust backend) + React 19 + TypeScript, using [React Flow](https://reactflow.dev/) (`@xyflow/react`) for the canvas and Tailwind v4 for styling.

## Highlights

- **Plugin-based node engine** — node types (LLM, Chat, JSON Storage, Trigger, Output, Notify, …) are registered plugins, not hardcoded. Data flows between nodes as a typed output envelope.
- **Encrypted credential vault** — API keys live in AES-256-GCM vaults (global + per-workspace), encrypted with a master key from the OS keychain. LLM inference runs in Rust so secrets never reach the renderer and CORS is avoided.
- **Node defaults** — override a node type's starting config at global or per-workspace scope so repeated setup isn't retyped.
- **Custom nodes** — author your own node types: presets over existing nodes, or sandboxed user-authored JavaScript executors (QuickJS-in-Rust with hard resource limits, an SSRF-guarded `fetch` allowlist, and server-side credential injection). Workspace-scoped with promote-to-global. See [docs/custom-nodes-design.md](docs/custom-nodes-design.md).
- **File-based workspaces** — each workspace is a folder on disk; all state lives under `.hive/` (atomic writes, small/stable space files).

## Prerequisites

- [Node.js](https://nodejs.org/) + npm
- [Rust toolchain](https://www.rust-lang.org/tools/install) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS (on Windows: WebView2 + the MSVC build tools)

## Getting started

```bash
npm install
npm run tauri dev      # run the desktop app (Vite on port 1420 + the WebView2 window)
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run tauri dev` | Run the Tauri desktop app in dev (the normal way to run Hive). |
| `npm run dev` | Vite dev server only — browser, no Tauri shell. |
| `npm run build` | Type-check (`tsc`) + Vite production build into `dist/`. |
| `npm run tauri build` | Full Tauri bundle (installers). |
| `cargo test -p hive-sandbox` | Run the script-sandbox unit tests (run from `src-tauri/`). |

There are no lint/test npm scripts; `tsc` (via `npm run build`) is the static check. The dev server is locked to port 1420 (Tauri expects it).

## Project layout

```
src/             React + TypeScript frontend
  engine/        plugin interface, registry, executor, connectivity, graph traversal
  nodes/plugins/ built-in node types
  components/    canvas, inspectors, settings, custom-node authoring
  services/      typed Tauri API wrappers, vault/defaults/concurrency
  theme/         JS-side colors (mirrors CSS tokens for React Flow / MiniMap)
  styles/        CSS token layer + per-surface stylesheets (composed by App.css)
src-tauri/       Rust backend (Tauri commands, vault, LLM inference)
  crates/sandbox  Tauri-free QuickJS sandbox (hive-sandbox)
docs/            design docs
```

## Architecture

Start with [docs/architecture-overview.md](docs/architecture-overview.md) — it maps every system and links to a per-system design doc:

- [Node engine](docs/node-engine.md) — plugin registry, output envelope, connectivity, concurrency.
- [Workflow execution](docs/workflow-execution.md) — the run loop, node status lifecycle, pause/resume.
- [Credential vault](docs/credential-vault.md) — encryption, two vaults, server-side resolution.
- [Workspace persistence](docs/workspace-persistence.md) — the `.hive/` layout, save/load, migrations.
- [Node defaults](docs/node-defaults.md) — global + per-workspace overrides.
- [Custom nodes](docs/custom-nodes-design.md) — presets + the sandboxed script-node threat model.

Each doc opens with a "living document" header naming the commit it was last verified against; see the overview for how to check whether a doc has drifted. For day-to-day working conventions, see [CLAUDE.md](CLAUDE.md).
