# Custom Nodes — Design & Implementation

> **📌 Living document — current design, not a contract.** Describes the *intended* design as of **2026-05-29** (commit `44704f6`, refactor pass Phases 3–4). The code is the source of truth: **if this doc and the code disagree, trust the code and fix the doc.** Detect drift by diffing the key paths since that commit, e.g. `git log --oneline 44704f6..HEAD -- src/types/customNodes.ts src/services/customNode* src/engine/ScriptExecutor.ts src/components/customNodes src-tauri/crates/sandbox`.

Status: **All three tiers implemented.** Tier 1 (presets) and the dynamic registry are
done; Tier 2 was folded into normal node development (it needs no custom-node
infrastructure); Tier 3 (sandboxed user-authored executors) is implemented across three
phases — sandbox + execution, gated network + credentials, and authoring/portability
polish. The only deferred item is a full import/marketplace grant-consent flow (see
[Deferred](#deferred-import--marketplace-grant-consent)).

This document records the approach for letting users create custom node types, each
workspace-scoped with the option to promote to global, and reflects what actually shipped
(noting where the implementation deviated from the original brief).

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
3. **User-authored executors** *(implemented)* — sandboxed user code. The only tier that
   needed genuinely new infrastructure (a QuickJS-in-Rust sandbox).

## Relevant existing architecture (build on these — don't re-derive)

- **Plugin registry**: [src/engine/pluginRegistry.ts](../src/engine/pluginRegistry.ts)
  is a **layered** singleton — built-ins register at startup via side-effect import of
  [src/nodes/plugins/index.ts](../src/nodes/plugins/index.ts); custom plugins are
  registered/unregistered at runtime via `registerCustom` / `clearCustomsByScope`, with a
  monotonic `version` signal (`subscribe` / `getVersion`) for `useSyncExternalStore`.
- **`NodePlugin` interface** ([src/engine/plugin.ts](../src/engine/plugin.ts)):
  `type`, `meta` (label/icon/category/color), `defaultData`, `component`,
  `inspector`, `defaultsEditor`, `executor`, `handles`, `getOutput`,
  `concurrencyPool`, `canPauseWorkflow`, `skipStorageSync`,
  `credentialSchemas`, and `baseType` (set on synthesized preset plugins so connectivity
  rules resolve through to the base type).
- **Engine**: [src/engine/index.ts](../src/engine/index.ts) `executeNode(type, ctx)`
  looks up the executor from the registry. Data flows as
  `NodeOutputEnvelope { value, metadata?, data? }`
  ([src/engine/types.ts](../src/engine/types.ts)); read upstream via
  `getUpstreamNodeEnvelope` ([src/engine/utils.ts](../src/engine/utils.ts)).
- **Credential vault**: keys never live in node data — only a `credentialId`
  string, resolved server-side in Rust. Global vault at
  `app_data_dir/credentials.vault`, local at `<ws>/.hive/credentials.vault`.
  Server-side resolution helper: `resolve_credential_values(app, id, scope_hint, ws)`
  in [src-tauri/src/commands.rs](../src-tauri/src/commands.rs). Scope-promotion exists via
  `credential_transfer` in [src-tauri/src/vault.rs](../src-tauri/src/vault.rs).
- **Concurrency governor**: [src/services/concurrency.ts](../src/services/concurrency.ts),
  pools `local`/`cloud`/`general`.
- **Disk writes** all go through `write_atomic`
  ([src-tauri/src/utils.rs](../src-tauri/src/utils.rs)).
- **LLM inference is in Rust** (`llm_chat`) to avoid CORS and keep keys off the renderer —
  the pattern Tier 3's `run_script` follows.
- **Reusable UI**: [NodeGridCard.tsx](../src/components/shared/NodeGridCard.tsx),
  [DashedAddCard.tsx](../src/components/shared/DashedAddCard.tsx),
  [NodePickerMenu.tsx](../src/components/shared/NodePickerMenu.tsx); ranked search in
  [src/utils/rankedSearch.ts](../src/utils/rankedSearch.ts).

## The core insight

All tiers need ONE missing piece: turn on-disk data into **registered plugins at
runtime**. The dynamic registry layer is built once; everything rides on it. Because the
engine, palette, connectivity, and node-defaults all consume `pluginRegistry`, once a
custom node is registered as a plugin everything works.

## Unified data model (discriminated by where behavior comes from)

Defined in [src/types/customNodes.ts](../src/types/customNodes.ts):

```ts
interface CustomNodeBase {
  id: string;              // registry type becomes `custom:<id>`
  name: string; icon: string;
  category: NodePlugin["meta"]["category"];  // drives synthesized meta.color via getCategoryColor()
  version: number;
}

type CustomNodeDefinition =
  | (CustomNodeBase & { kind: "preset"; baseType: string; presetData: Record<string, unknown> })
  | (CustomNodeBase & {
      kind: "script";
      runtime: "js" | "wasm";        // only "js" implemented; "wasm" reserved
      entry: string;                 // source filename, default "script.js"
      configSchema: ScriptField[];   // per-instance inspector fields → ctx.config
      network: NetworkGrant;         // { mode: "none" | "allowlist"; allow: string[] }
      credentials: string[];         // granted credentialIds the script may inject
      limits: ScriptLimits;          // { timeoutMs; memoryBytes } — clamped server-side
      handles?: HandleConfig[];      // omitted → engine default (in-left, out-right)
    });
```

The synthesized `script` plugin carries **no `source` field** — code lives only in
`script.js` on disk (single source of truth). `scope` is not stored in the definition; the
registry tracks it (`customScopes` map) and the loader threads it into the executor.

**No color field.** Phase 3 (May 2026) dropped the per-definition `color` knob. The
synthesized plugin's color is derived purely from `category` via `getCategoryColor`
([src/theme/colors.ts](../src/theme/colors.ts)), so authors only pick a category and
custom nodes group sensibly with built-ins of the same kind. The Rust
`CustomNodeDefinition` ([models.rs](../src-tauri/src/models.rs)) accepts an optional
legacy `color` on read and drops it on write, so older `node.json` files still load.

A **loader** ([src/services/customNodeLoader.ts](../src/services/customNodeLoader.ts))
reads definitions, synthesizes a `NodePlugin` per definition via `synthesizePlugin(def,
scope)`, then `pluginRegistry.registerCustom(plugin, scope)`. Disk + registry lifecycle and
CRUD live in [src/services/customNodesService.ts](../src/services/customNodesService.ts)
and [src/contexts/CustomNodesContext.tsx](../src/contexts/CustomNodesContext.tsx) (global
loaded once at app start; workspace customs swapped on workspace enter/leave).

## Tier 1 — Presets/templates

The synthesized plugin **reuses the base plugin's** `executor`, `inspector`, `handles`,
`getOutput`, `concurrencyPool`, `credentialSchemas`; only `meta` and `defaultData`
(`{ ...base.defaultData, ...presetData, label }`) come from the definition. **Zero new code
runs.** Authoring paths: a "Save selected node as custom node" action that snapshots the
node's current `data` as `presetData`, plus from-scratch creation in the Nodes tab /
Settings.

## Tier 2 — Configurable generic nodes (not a separate tier)

A "configurable generic node" is just a Tier-1 preset over a built-in primitive. Since
`synthesizePlugin` reuses *any* base plugin's executor/inspector/handles generically, and
`AutoDefaultsEditor` auto-generates the preset config form for any node without a custom
`defaultsEditor`, the moment a new built-in primitive ships, presets over it work **for
free**. The only remaining work is ordinary node development (author `httpRequest`,
`promptTemplate`, etc. as normal `NodePlugin`s). **Carry-over build rule:** networked/secret
primitives run in Rust like `llm_chat` (CORS-free, vault `credentialId` injection, SSRF
chokepoint), reusing the concurrency governor.

## Tier 3 — User-authored executors (implemented)

Behavior = user code, so the whole game is **isolation**. As built:

- **Runs in Rust, not the renderer.** A `run_script` Tauri command
  ([src-tauri/src/commands.rs](../src-tauri/src/commands.rs)) executes the source in an
  isolated **QuickJS runtime via `rquickjs`** (JS only; `wasmtime`/WASM is reserved but not
  implemented — an unsupported runtime returns a clear error). Each run gets a fresh
  `Runtime` with `set_memory_limit`, `set_max_stack_size`, and an interrupt handler that
  aborts at a wall-clock deadline. It runs on a `spawn_blocking` thread. The sandbox itself
  (`run_quickjs` + the gated `do_fetch` + SSRF guards) lives in the **Tauri-free
  [`hive-sandbox`](../src-tauri/crates/sandbox) crate**; `run_script` only reads the on-disk
  definition/grants and supplies a `CredentialResolver` (`VaultResolver`) so the crate stays
  GUI-free and unit-testable natively.
- **Disk is authoritative for code AND grants.** `run_script` reads `script.js` *and* the
  capability grants/limits from `node.json` directly off disk (by scope + id +
  workspace_path). The renderer only supplies per-instance `input` (the resolved upstream
  envelope) + `config`. A buggy/compromised renderer therefore cannot widen a script's
  limits, network reach, or credential access. *(This is stronger than the original
  brief, which implied passing grants from the renderer.)*
- **Stable contract (synchronous).** The source file IS the body of `(ctx) => { … }`.
  `ctx = { input, config, log, fetch }`. Whatever the function **returns** becomes the
  output (a string → `{ value }`; an object → used as the envelope; coerced/normalized
  server-side). *Deviation from the brief:* there is no `setOutput` (return value instead),
  and `fetch` is **synchronous** (`const res = ctx.fetch(url, opts)`), not `await`-based —
  see the fetch note below. A starter `script.js` is seeded on first open.
- **`ctx.fetch` is gated + blocking.** `fetch(url, opts)` returns `{ status, ok, body,
  headers }` and throws on a network/permission error. All policy is enforced Rust-side in
  `do_fetch`: scheme must be http/https; host must match the `network.allow` globs
  (`*` and `*.suffix` supported); private/loopback/link-local/`::1`/`fc00::`/`fe80::`
  targets are blocked unless listed *exactly* in the allowlist (so `*` can't reach internal
  services); response body + headers are size-capped. Beyond the host-string check, the host
  is **resolved and its IPs validated post-DNS**, and the connection is **pinned to the vetted
  address** (`reqwest`'s `resolve`) — closing the DNS-rebinding / check-then-connect TOCTOU.
  The per-request timeout is the smaller of the network ceiling and the script's **remaining
  wall-clock budget**, so a blocking fetch can't overrun the script's own timeout.
- **Credential injection for the script.** `fetch` options may name a `credentialId` (plus
  optional `credentialHeader` / `credentialPrefix`, default `Authorization: Bearer`). Rust
  checks the id is in the on-disk `credentials` grant, resolves it via
  `resolve_credential_values`, and sets the header. The plaintext **never enters the JS
  heap**.
- **One `ScriptExecutor` adapter** ([src/engine/ScriptExecutor.ts](../src/engine/ScriptExecutor.ts))
  implements `NodeExecutor` for every script node. `synthesizePlugin` constructs it with
  `(id, scope, configSchema)`; it resolves the upstream input envelope (like `LLMExecutor`),
  collects the declared config keys from `node.data`, calls `api.runScript`, and writes
  `outputEnvelope` / `lastResponse` / `logs` back. On error it throws so the runner's retry
  path works.
- **Inspector** ([src/components/inspectors/ScriptNodeInspector.tsx](../src/components/inspectors/ScriptNodeInspector.tsx)):
  per-instance config fields (from `configSchema`), a run button, output + logs consoles, an
  "Open script in editor" action, and a **dangling-credential banner** (grants that don't
  resolve on this machine).
- **Authoring** is in [CustomNodeFormModal.tsx](../src/components/customNodes/CustomNodeFormModal.tsx)
  (Preset | Script toggle): metadata, scope, name/icon, then a Preset or Script branch.
  Phase 4 split the per-branch bodies into [PresetNodeForm.tsx](../src/components/customNodes/PresetNodeForm.tsx)
  (`PresetBaseTypeSection` + `PresetConfigSection`) and
  [ScriptNodeForm.tsx](../src/components/customNodes/ScriptNodeForm.tsx) (limits, network
  mode + allowlist editor, credential grant checkboxes via
  [CredentialGrantList.tsx](../src/components/customNodes/CredentialGrantList.tsx), the
  `configSchema` field builder, and a custom `handles` editor). The modal itself stays
  thin — it owns state and validation (`validateScriptDef`) and delegates rendering. Form
  styling goes through the shared `formLabelClass` / `formInputClass` constants in
  [FormField.tsx](../src/components/shared/FormField.tsx).

### Editor: bring-your-own, not embedded

*Deviation from the brief (which specified a Monaco editor).* There is **no in-app code
editor**. Source lives in `script.js`; the user edits it in their own editor (VS Code,
Cursor, …). The `open_custom_node_script` command ensures the file exists (seeding a starter
template) and then **reveals it in the OS file manager** rather than launching it — on
Windows the default handler for `.js` would *execute* the file via Windows Script Host. This
keeps the app lean (no Monaco bundle) and makes the on-disk file the single source of truth.

## Storage & scoping (mirror node-defaults + vault patterns)

```
<ws>/.hive/custom-nodes/<id>/node.json   # workspace-scoped definition
<ws>/.hive/custom-nodes/<id>/script.js   # tier-3 source (kept out of node.json)
app_data_dir/custom-nodes/<id>/...       # global-scoped
```

Folder-per-node. Rust commands (in [commands.rs](../src-tauri/src/commands.rs)):
`list/save/delete_{global,workspace}_custom_node`, `custom_node_transfer` (promote
workspace → global, mirroring `credential_transfer`), `open_custom_node_script`, and
`run_script`. The Rust `CustomNodeDefinition` struct
([models.rs](../src-tauri/src/models.rs)) types the common fields and uses
`#[serde(flatten)] extra`, so script-only fields round-trip without a struct change.

## Hard problems — how each was resolved

1. **Registry lifecycle.** Layered registry: built-ins (permanent) + global customs (load
   once at app start) + workspace customs (**swapped** on workspace enter/leave via the
   `CustomNodesProvider`, same lifecycle as `NodeDefaultsProvider`).
2. **Graceful "missing definition."** A space file may reference `custom:<id>` with no
   definition on disk → degrades to a visible "unknown custom node" placeholder
   ([unknownCustomPlugin.tsx](../src/components/customNodes/unknownCustomPlugin.tsx)); never
   crashes load.
3. **Namespacing.** Custom types are prefixed `custom:<id>`.
4. **Portability.** Global customs (definition + `script.js`) travel between machines;
   `credentialId` references do **not** (per-machine vault). Transplanted/promoted script
   nodes with unresolved grants surface a dangling-credential banner in the inspector and
   "granted but unavailable here" chips in the authoring modal.
5. **Versioning/migration.** Reuses the `version` field + the legacy-migration discipline
   from `storage.ts` / `commands.rs`.
6. **Security threat model (Tier 3).** SSRF (host allowlist + private-range block, explicit
   opt-in required, **plus a post-resolution private-IP check with connection pinning** to
   close DNS rebinding), secret exfiltration (credentials injected server-side, never in the JS
   heap; logs returned only to the renderer and stripped from the saved space file), resource
   exhaustion (memory/stack/time ceilings clamped server-side regardless of the definition's
   requested limits, and `ctx.fetch` capped to the script's remaining time budget).

## Implemented sequence

- **Tier 1 — done:** definition model + disk storage + layered dynamic registry
  (namespacing + workspace swap + graceful-missing) + presets.
- **Tier 2 — ongoing (not a phase):** author generic primitives as normal built-ins,
  Rust-side for networked ones. Presets over them come free.
- **Tier 3 — done, in three phases:**
  - **A — sandbox + execution (no network):** `ScriptCustomNode` type, `synthesizePlugin`
    script branch + scope threading, `ScriptExecutor`, `run_script` (rquickjs with hard
    limits), `open_custom_node_script`, `ScriptNodeInspector`, and the Script authoring
    toggle.
  - **B — gated network + credentials:** SSRF guard, `ctx.fetch`, Rust-side credential
    injection, and the network allowlist + credential-grant authoring UI.
  - **C — authoring & portability polish:** `configSchema` builder, custom `handles`
    editor, and the dangling-credential banner.

### Deferred: import / marketplace grant-consent

Not built. There's no "import a node from an external source" action yet (nodes travel via
the global-scope folder / promote-to-global), so a grant-consent screen has no trigger.
Sequence when wanted: build an import action first, then gate it behind a grant-review
modal. The portability-mismatch surface it would protect is already covered by the
dangling-credential banner.

## Testing & verification notes

- **Rust sandbox tests** live in the Tauri-free [`hive-sandbox`](../src-tauri/crates/sandbox)
  crate (`net.rs` + `runtime.rs`): QuickJS execution, log collection, envelope coercion,
  timeout-kill, error surfacing; the SSRF guards (glob matching, private-host/IP detection,
  allowlist gating, wildcard-can't-reach-loopback, scheme rejection); the post-resolution
  private-IP check and fetch-timeout-budget; and credential gating via a mock
  `CredentialResolver` (ungranted refused, missing resolver, resolve failure). Run them
  natively anywhere with **`cargo test -p hive-sandbox`** — **no Windows manifest workaround
  needed**, because the crate links no GUI/Tauri deps. (This crate extraction is the "cleaner
  long-term fix" the earlier note anticipated; the sandbox — `run_quickjs` / `do_fetch` /
  guards — now lives there behind a `CredentialResolver` trait the Tauri side implements with
  `VaultResolver`.)
- **⚠️ Windows `cargo test` gotcha (GUI crate only).** Running the *whole* workspace's tests
  (`cargo test`) still drags in the `hive` bin/lib, whose bare test harness has no application
  manifest, so the loader binds the legacy comctl32 v5.82 (missing `TaskDialogIndirect` /
  `*WindowSubclass` that Tauri's dialog/window code imports) and the test exe fails to start
  with `STATUS_ENTRYPOINT_NOT_FOUND` (0xC0000139). The real app is unaffected (tauri_build
  embeds a Common-Controls v6 manifest). The sandbox tests sidestep this entirely — prefer
  `cargo test -p hive-sandbox`. If you ever add tests to the GUI crate, use the workaround:
  copy [src-tauri/manifests/common-controls-v6.manifest](../src-tauri/manifests/common-controls-v6.manifest)
  next to the built test exe as `<exe>.exe.manifest`, then run the exe. (On Linux/CI there is
  no comctl32, so `cargo test` runs as-is.)
- **GUI end-to-end** still needs a manual pass in `npm run tauri dev` (create a script node,
  reveal + edit `script.js`, wire Trigger→Script→Output and run; then exercise allowlisted
  vs. disallowed `fetch` with a granted credential).
