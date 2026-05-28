# Custom Nodes — Design Brief

Status: **Tier 1 implemented.** Tier 2 was folded into normal node development (see
below — it needs no custom-node infrastructure). Tier 3 remains future work. This
documents the approach for letting users create custom node types, scoped per-workspace
with the option to promote to global.

## Goal

Let users create custom node types, each workspace-scoped with promote-to-global. The
original brief framed this as three tiers; in practice only two need dedicated
infrastructure:

1. **Presets/templates** *(implemented)* — a saved configuration of an existing node
   type. This is the whole custom-node system: a dynamic registry that synthesizes a
   `NodePlugin` from an on-disk definition.
2. ~~**Configurable generic nodes**~~ — *not a separate tier.* "Configurable generic
   node" = a Tier-1 preset over a built-in primitive (HTTP, etc.). Shipping such a
   primitive is ordinary node development; presets over it then work for free. See
   [Tier 2](#tier-2--configurable-generic-nodes-not-a-separate-tier).
3. **User-authored executors** *(future)* — sandboxed user code. The only tier that
   needs genuinely new infrastructure.

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

## Tier 2 — Configurable generic nodes (not a separate tier)

**This is not a phase of the custom-node effort.** A "configurable generic node" is
just a Tier-1 preset over a built-in primitive. Since `synthesizePlugin`
([src/services/customNodeLoader.ts](../src/services/customNodeLoader.ts)) reuses *any*
base plugin's executor/inspector/handles generically, and `AutoDefaultsEditor`
auto-generates the preset config form for any node without a custom `defaultsEditor`,
the moment a new built-in primitive ships, presets over it work **for free** — no
custom-node code changes.

So the only remaining work is ordinary node development: author primitives like
`httpRequest`, `promptTemplate`, `conditional`, `jsonTransform`, `delay` as normal
`NodePlugin`s, on whatever timeline the product needs them.

**Carry-over build rule (a property of the node, not the preset system):** when you add
a networked/secret primitive such as an HTTP node, run it in Rust like `llm_chat` —
CORS-free requests, vault `credentialId` injection, and an SSRF/allowlist chokepoint —
rather than `fetch` in the renderer. Reuse the concurrency governor for pools.

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
6. **Security threat model** for the HTTP primitive and tier 3: SSRF on the HTTP
   primitive, secret exfiltration from scripts, resource exhaustion. Treat tier 3 like
   a plugin marketplace threat model.

## Recommended sequence

- **Phase 1 — done:** definition model + disk storage + **layered dynamic registry**
  (namespacing + workspace swap + graceful-missing) + Tier 1 presets on top. The dashed
  "+" stubs are now live entry points.
- **Ongoing (not a phase):** author generic primitives (`httpRequest`, etc.) as normal
  built-ins when the product needs them, Rust-side for networked ones. Presets over them
  come free — no custom-node changes required.
- **Phase 2 (future) — Tier 3:** QuickJS-in-Rust sandbox + capability model + Monaco
  inspector + limits. This is the only remaining work that needs new infrastructure.

**Tier 3 stays last.** It's the sole tier that adds structural complexity (a sandbox);
everything else is reuse of existing systems (defaults, scoping, vault, envelope
contract) already proven by the Tier-1 dynamic-registry work.
