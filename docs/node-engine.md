# Node Engine

> **📌 Living document — current design, not a contract.** Describes the *intended* design as of **2026-05-28** (commit `c748831`). The code is the source of truth: **if this doc and the code disagree, trust the code and fix the doc.** Detect drift by diffing the paths under [Key files](#key-files) since that commit, e.g. `git log --oneline c748831..HEAD -- src/engine`.

The node engine is the plugin system every other system rides on. It answers four questions: *what is a node type*, *how are node types registered*, *how does a node run*, and *how does data move between nodes*. The orchestration of *when* nodes run is a separate system — see [workflow-execution.md](workflow-execution.md).

## The plugin contract

A node type is a `NodePlugin` ([src/engine/plugin.ts](../src/engine/plugin.ts)). Nothing about a node type is hardcoded in the engine; it all comes from this object:

| Field | Purpose |
|---|---|
| `type` | unique id (e.g. `"llm"`, `"chat"`, `"custom:abc123"`) |
| `meta` | label, icon, `description`, `category` (`input`/`processing`/`output`/`storage`/`custom`), color |
| `defaultData` | data applied to a freshly created node (before defaults overrides) |
| `component?` | custom React node renderer; falls back to `GenericNodeShell` |
| `inspector?` | the panel shown when the node is selected |
| `defaultsEditor?` | lightweight editor for global/workspace defaults (see [node-defaults.md](node-defaults.md)) |
| `executor?` | runs the node during a workflow (see below) |
| `handles?` | connection handles; defaults to target-left + source-right |
| `getOutput?` | custom extraction of this node's output envelope from its data |
| `concurrencyPool?` | pool name (or fn of node data) for the concurrency governor |
| `canPauseWorkflow?` | node may halt a run to await input (Chat sets this) |
| `skipStorageSync?` | engine skips post-execution storage sync (Chat sets this — it syncs itself) |
| `aliases?` | backward-compatible alternate type ids |
| `credentialSchemas?` | credential shapes the node can consume (drives the picker) |
| `baseType?` | for synthesized custom presets: the built-in type whose behavior they reuse |

## The registry

[src/engine/pluginRegistry.ts](../src/engine/pluginRegistry.ts) is a singleton `PluginRegistry`. It is **layered**:

- **Built-ins** register at startup via a side-effect import of [src/nodes/plugins/index.ts](../src/nodes/plugins/index.ts) (`App.tsx` imports `@/nodes/plugins`). These are permanent.
- **Custom nodes** register at runtime through `registerCustom(plugin, scope)` / `unregisterCustom(type)` / `clearCustomsByScope(scope)`, where scope is `"global"` or `"workspace"`. The registry tracks each custom type's scope in a `customScopes` map. See [custom-nodes-design.md](custom-nodes-design.md).

Registration by alias: `register()` also stores the plugin under each entry in `aliases`, so renamed/legacy types still resolve. `getAll()` de-dupes so a plugin with aliases appears once in the palette.

**Reactivity.** The registry is a `useSyncExternalStore` source: it keeps a monotonic `version`, a `subscribe(cb)`, and `getVersion()`. Every custom register/unregister calls `bump()`, which increments the version and notifies listeners. UI that lists node types (palette, pickers) re-renders when customs change. Built-in `register()` does *not* bump (it only runs at startup, before anything subscribes). The hook wrapper is [src/hooks/useRegistryVersion.ts](../src/hooks/useRegistryVersion.ts).

Convenience accessors: `get(type)`, `getExecutor(type)`, `getColor`, `getIcon`, `getNodeDefinitions()` (palette), `getNodeTypesMap(fallback)` (React Flow's `nodeTypes`), `getCredentialSchemas()` (all schemas across plugins, deduped).

## Executing one node

[src/engine/index.ts](../src/engine/index.ts) exports `executeNode(type, ctx)`. The flow:

1. Look up the plugin's `executor`.
2. **If there is an executor**, call `executor.execute(ctx)`. The executor reads its inputs, does its work, and writes its output back onto node data.
3. **If there is no executor** (e.g. Trigger), the node is *passive*: the engine finds the first incoming non-storage edge from a *visited* upstream node, resolves that node's envelope, and writes it to this node's `lastResponse` + `outputEnvelope`. A Trigger with no upstream therefore propagates `{ value: "" }`.
4. **Post-execution storage sync** (unless `skipStorageSync`): the engine walks outgoing edges to `storage`-category nodes that have write permission (`write-only` or `read-write`) and appends a record `{ id, timestamp, source, content, envelope }`. A 500 ms same-content dedupe guard prevents double-writes within one tick.

```
executeNode(type, ctx)
   ├─ plugin.executor?  ──▶ executor.execute(ctx)        // active node
   └─ else              ──▶ propagate upstream envelope   // passive node
            │
            └─▶ unless skipStorageSync:
                   for each outgoing edge to a storage node with write perm:
                       append { id, timestamp, source, content, envelope }
```

`ExecutionContext` ([src/engine/types.ts](../src/engine/types.ts)) carries `node`, `nodes`, `edges`, `updateNodeData`, `showToast`, optional `chatInput`, `visited` (the run's visited set), and `workspacePath` (needed for vault resolution). The run loop builds this; see [workflow-execution.md](workflow-execution.md).

## The output envelope contract

All inter-node data is a `NodeOutputEnvelope`:

```ts
{ value: string;            // the primary text output; text-only nodes use this directly
  metadata?: Record<string, any>;  // model, tokens, status codes, timestamps…
  data?: any }              // rich structured payload (parsed JSON, full records…)
```

Reads go through [src/engine/utils.ts](../src/engine/utils.ts):

- `getUpstreamNodeData(node)` → the string `value`, trying in order: plugin `getOutput`, `data.outputEnvelope`, then legacy fallbacks `lastResponse` → `outputContent` → `output` → `value`.
- `getUpstreamNodeEnvelope(node)` → the full envelope, with the same precedence; if only a raw string exists it's wrapped into a fallback envelope.

> **Invariant for new executors:** write **both** `lastResponse` (string) and `outputEnvelope` (full envelope) onto node data. Downstream nodes may read either path, and the legacy fallbacks exist only for saved data that predates the envelope.

Example, from [LLMExecutor](../src/engine/LLMExecutor.ts):

```ts
const outputEnvelope = { value: response, metadata: { model, provider, … }, data: { reply: response } };
updateNodeData(node.id, { ...node.data, lastResponse: response, outputEnvelope });
```

## Connectivity rules

[src/engine/connectivity.ts](../src/engine/connectivity.ts) `getConnectionBehavior(sourceType, targetType, sourceHandle, targetHandle)` decides whether an edge is legal and its default *flow direction*:

- Flow directions: `one-way`, `bi-directional`, `read-only`, `write-only`, `read-write`.
- Anything touching `jsonStorage` resolves to a **database edge** (read-only / write-only / read-write) depending on direction and whether the Chat "storage" bottom handle is used.
- Pairs in `CONNECTION_RULES` get their declared behavior — currently Chat→LLM (and the legacy Chat→ollama) default to `bi-directional` with a toggle.
- Everything else defaults to strict `one-way`.
- **Custom presets resolve through `baseType`** via `effectiveType()`, so a preset over `llm` keeps `llm`'s edge behavior.

New node-pair behaviors go in `CONNECTION_RULES`.

## Concurrency governor

[src/services/concurrency.ts](../src/services/concurrency.ts) exposes the singleton `concurrencyGovernor`. Executors that do expensive/network work wrap it in `concurrencyGovernor.enqueue(pool, task)` to respect a per-pool parallelism limit:

- Pools: `local`, `cloud`, `general`. Legacy names auto-resolve (`ollama`→`local`, `llm`→`cloud`).
- `isLocalModel(provider, baseURL)` matches the user's wildcard `localPatterns` (e.g. `*localhost*`) to decide local vs. cloud — so the LLM executor picks its pool dynamically.
- Limits live in Settings, persisted to `localStorage` via [src/services/storage.ts](../src/services/storage.ts) (with legacy-schema migration). When a pool is disabled, tasks run with unbounded parallelism.

The governor is a simple semaphore: a counter of active tasks plus a queue of resolver callbacks; releasing a slot dequeues the next waiter.

## Adding a node type

1. Create a plugin under `src/nodes/plugins/` and register it in [src/nodes/plugins/index.ts](../src/nodes/plugins/index.ts).
2. Add an inspector under `src/components/inspectors/` and re-export it from `inspectors/index.ts`. Use `GenericNodeShell` unless you need custom rendering.
3. Implement an `executor` only if the node *does* something. Read inputs with `getUpstreamNodeEnvelope`; write `lastResponse` + `outputEnvelope`. Wrap network work in `concurrencyGovernor.enqueue`.
4. If it needs secrets, declare `credentialSchemas` and pass `node.data.credentialId` + `ctx.workspacePath` to a Tauri command that resolves the secret server-side — **never decrypt in the renderer for execution** (see [credential-vault.md](credential-vault.md)).

## Key files

- [src/engine/plugin.ts](../src/engine/plugin.ts) — the `NodePlugin` interface.
- [src/engine/pluginRegistry.ts](../src/engine/pluginRegistry.ts) — the registry.
- [src/engine/index.ts](../src/engine/index.ts) — `executeNode` + storage sync.
- [src/engine/types.ts](../src/engine/types.ts) — `ExecutionContext`, `NodeOutputEnvelope`, `NodeExecutor`.
- [src/engine/utils.ts](../src/engine/utils.ts) — upstream readers.
- [src/engine/connectivity.ts](../src/engine/connectivity.ts) — edge rules.
- [src/services/concurrency.ts](../src/services/concurrency.ts) — the governor.
- [src/nodes/plugins/](../src/nodes/plugins/) — the built-in node types.
