# Custom Nodes — Design Brief

Status: **design only, not implemented.** This documents the recommended approach
for letting users create custom node types in three tiers, scoped per-workspace
with the option to promote to global.

## Goal

Three tiers of custom nodes, each workspace-scoped with promote-to-global:

1. **Presets/templates** — a saved configuration of an existing node type.
2. **Configurable generic nodes** — built-in parameterized primitives (HTTP, etc.).
3. **User-authored executors** — sandboxed user code.

## Relevant existing architecture (build on these — don't re-derive)

- **Plugin registry**: [src/engine/pluginRegistry.ts](../src/engine/pluginRegistry.ts)
  is a **static** singleton; plugins register at startup via side-effect import of
  [src/nodes/plugins/index.ts](../src/nodes/plugins/index.ts).
- **`NodePlugin` interface** ([src/engine/plugin.ts](../src/engine/plugin.ts)):
  `type`, `meta` (label/icon/category/color), `defaultData`, `component`,
  `inspector`, `defaultsEditor`, `executor`, `handles`, `getOutput`,
  `concurrencyPool`, `canPauseWorkflow`, `skipStorageSync`, `aliases`,
  `credentialSchemas`.
- **Engine**: [src/engine/index.ts](../src/engine/index.ts) `executeNode(type, ctx)`
  looks up the executor from the registry. Data flows as
  `NodeOutputEnvelope { value, metadata?, data? }`
  ([src/engine/types.ts](../src/engine/types.ts)); read upstream via
  `getUpstreamNodeEnvelope`.
- **Credential vault**: keys never live in node data — only a `credentialId`
  string, resolved server-side in Rust (`llm_chat`). Global vault at
  `app_data_dir/credentials.vault`, local at `<ws>/.hive/credentials.vault`.
  Scope-promotion already exists: `credential_transfer` in
  [src-tauri/src/vault.rs](../src-tauri/src/vault.rs).
- **Node defaults** (already built): global `app_data_dir/node-defaults.json` +
  workspace `<ws>/.hive/node-defaults.json`; merged at create time as
  `plugin.defaultData ← global[type] ← workspace[type]` in
  `WorkspaceEditor.handleAddNode` and `useWorkspaceDragDrop`, read via
  `useNodeDefaults().getMergedOverrides`
  ([src/contexts/NodeDefaultsContext.tsx](../src/contexts/NodeDefaultsContext.tsx),
  [src/services/nodeDefaultsService.ts](../src/services/nodeDefaultsService.ts)).
  Editors: `DefaultsEditorModal` + `LLMDefaultsEditor` / `AutoDefaultsEditor` fallback.
- **Concurrency governor**: [src/services/concurrency.ts](../src/services/concurrency.ts),
  pools `local`/`cloud`/`general`.
- **Disk writes** all go through `write_atomic`
  ([src-tauri/src/utils.rs](../src-tauri/src/utils.rs)).
- **LLM inference is in Rust** (`llm_chat`) to avoid CORS and keep keys off the renderer.
- **Reusable UI already exists**:
  [NodeGridCard.tsx](../src/components/shared/NodeGridCard.tsx),
  [DashedAddCard.tsx](../src/components/shared/DashedAddCard.tsx),
  [NodePickerMenu.tsx](../src/components/shared/NodePickerMenu.tsx); ranked search in
  [src/utils/rankedSearch.ts](../src/utils/rankedSearch.ts). Dashed "+ custom node"
  stubs already placed on the landing-page Nodes tab
  ([NodesPage.tsx](../src/components/NodesPage.tsx)) and the workspace node palette
  ([NodePaletteSection.tsx](../src/components/inspectors/NodePaletteSection.tsx)).

## The core insight

All three tiers need ONE missing piece: turn on-disk data into **registered
plugins at runtime**. Build a dynamic registry layer once; all tiers ride on it.
Because the engine, palette, connectivity, and node-defaults all consume
`pluginRegistry`, once a custom node is registered as a plugin everything works.

## Unified data model (discriminated by where behavior comes from)

```ts
interface CustomNodeBase {
  id: string;              // registry type becomes `custom:<id>`
  name: string; icon: string; color: string;
  category: NodePlugin["meta"]["category"];
  scope: "workspace" | "global";
  handles?: HandleConfig[];
  credentialSchemas?: CredentialSchema[];
  version: number;
}

type CustomNodeDefinition =
  | (CustomNodeBase & { kind: "preset"; baseType: string; presetData: Record<string, unknown> })
  | (CustomNodeBase & { kind: "script"; runtime: "js" | "wasm"; entry: string; configSchema: Field[] });
// "configurable generic" = kind:"preset" over a generic base plugin (see Tier 2)
```

A **loader** reads definitions, synthesizes a `NodePlugin` per definition, then
calls a new `pluginRegistry.registerCustom(plugin)`.

## Tier 1 — Presets/templates (build first)

The synthesized plugin **reuses the base plugin's** `executor`, `inspector`,
`handles`, `getOutput`, `concurrencyPool`, `credentialSchemas`; only `meta` and
`defaultData` (`{ ...base.defaultData, ...presetData }`) come from the definition.
**Zero new code runs** — it's the node-defaults machinery promoted to named palette
entries. Fastest authoring path: a "Save selected node as custom node" action that
snapshots the node's current `data` as `presetData`.

## Tier 2 — Configurable generic nodes

Really "Tier 1 over a richer set of primitives you author." Ship 3–5 generic
built-in plugins — `httpRequest`, `promptTemplate`, `conditional`, `jsonTransform`,
`delay` — as normal `NodePlugin`s with config-driven executors. A tier-2 custom node
is just a preset over one of these. **Route any networked/secret primitive through a
Rust command** (like `llm_chat`): CORS-free requests, vault `credentialId` injection,
and an SSRF/allowlist chokepoint. Reuse the concurrency governor for pools.

## Tier 3 — User-authored executors (build last)

Behavior = user code, so the whole game is **isolation**:

- **Run it in Rust, not the renderer.** QuickJS via `rquickjs` (JS) and/or `wasmtime`
  (WASM) inside a `run_script` Tauri command. Renderer Web Workers have ambient
  `fetch`/DOM and are hard to lock down.
- **Stable contract:** script receives the input `NodeOutputEnvelope` (+ upstream
  data) and returns one. Host API is only what you expose: `input`, `setOutput`,
  gated `fetch` (allowlist), `log`. Prefer using credentials *for* the script
  (Rust injects the auth header) over handing plaintext to untrusted code.
- **Capabilities are explicit grants:** network allowlist, allowed `credentialId`s,
  CPU/timeout/memory limits.
- **Inspector** = Monaco editor + permissions panel + declared input/output handle
  schema. One `ScriptExecutor` adapter handles every tier-3 node via `run_script`.

## Storage & scoping (mirror node-defaults + vault patterns)

```
.hive/custom-nodes/<id>/node.json     # workspace-scoped definition
.hive/custom-nodes/<id>/script.js     # tier-3 source (keep out of JSON)
app_data_dir/custom-nodes/<id>/...    # global-scoped
```

Use folder-per-node (tier-3 source can be large). Rust commands `list/load/save/
delete_custom_node` per scope via `write_atomic`. **"Promote workspace → global"** is
the same move as `credential_transfer`; model the UX on the existing transfer button.

## Hard problems to design up front

1. **Registry lifecycle (riskiest refactor).** Make the registry **layered**:
   built-ins (permanent) + global customs (load once at app start) + workspace
   customs (**swap** on workspace enter/leave; hook the same lifecycle as
   `NodeDefaultsProvider`). Failing to unregister workspace A's customs leaks them
   into workspace B.
2. **Graceful "missing definition."** A saved space file can contain type
   `custom:abc`. If the def is gone, degrade to a visible "unknown custom node"
   placeholder — never crash load. Same pattern as the missing-credential banner.
3. **Namespacing.** Prefix custom types (`custom:<id>`) to avoid collisions with
   built-ins or each other.
4. **Portability.** Global customs travel between machines (tier-3 source too), but
   credential references / machine-specific bits don't — decide what's portable.
5. **Versioning/migration.** Reuse the `version` + legacy-migration discipline from
   `storage.ts` / `commands.rs`.
6. **Security threat model** for tiers 2–3: SSRF on the HTTP primitive, secret
   exfiltration from scripts, resource exhaustion. Treat tier 3 like a plugin
   marketplace threat model.

## Recommended sequence

- **Phase 1:** definition model + disk storage + **layered dynamic registry**
  (namespacing + workspace swap + graceful-missing) + Tier 1 presets on top.
  Exercises the whole pipeline at low risk; the dashed "+" stubs become entry points.
- **Phase 2:** author 2–3 generic primitives (Rust-side for networked ones); presets
  over them come free.
- **Phase 3:** QuickJS-in-Rust sandbox + capability model + Monaco inspector + limits.

**Strong recommendation: do NOT start with tier 3.** Foundation + presets first —
mostly reuse of existing systems (defaults, scoping, vault, envelope contract), and
it proves the dynamic-registry refactor, which is the real structural change.
