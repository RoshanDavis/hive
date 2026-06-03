# Agent Node

> **📌 Living document — current design, not a contract.** Describes the *intended* design as of **2026-06-03** (commit `eecbf93` + the agent functionality pass on `feat/agent-node`: **agent memory tools**, the **unified tool create/edit/config modal**, the **MCP Windows spawn fix + vault-injected MCP secrets**, the **tool-round limit toggle**, and the **Tools settings panel**). The code is the source of truth: **if this doc and the code disagree, trust the code and fix the doc.** Detect drift by diffing the paths under [Key files](#key-files) since that commit, e.g. `git log --oneline eecbf93..HEAD -- src/engine/agentTools.ts src/engine/agentMemory.ts src/components/inspectors/shared/ src-tauri/src/commands/mcp.rs src-tauri/src/commands/tools.rs`.

The **Agent** is a composite node: a single node that bundles an **LLM**, a **memory/storage** backend, and a set of **tools**, with one input port and one output port. On the canvas it renders large, with three dotted-border *slot boxes* (LLM / Storage / Tools) the user fills by dragging a node onto a box or clicking it to configure.

## Why composite-slots, not React-Flow nesting

The inner LLM/Storage/Tools are **slots stored in `node.data`**, *not* separate React-Flow nodes with `parentId`. Reasons:

- The Rust persistence struct `FlowNode` ([src-tauri/src/models.rs](../src-tauri/src/models.rs)) stores only `id` / `type` / `position` / `data` — no `#[serde(flatten)]` catch-all, so `parentId`/`width`/`height`/`extent` would be **dropped on save**. True nesting would force backend schema changes, parent-before-child ordering, and session/snapshot rework.
- The inner parts are never wired to the outside graph — they *are* the agent's parts. Modeling them as `data` slots means the whole node round-trips as opaque JSON and reuses the existing run loop / edge / persistence machinery unchanged.
- It matches the concept: an agent *is* one unit (LLM + memory + tools).

## Data model

One `FlowNode`, `type: "agent"`. Shape in [src/nodes/types.ts](../src/nodes/types.ts):

```ts
interface AgentNodeData {
  label: string;
  llm: AgentLLMSlot | null;       // Omit<LLMNodeData, "label"> — same shape the LLM node uses
  storage: AgentStorageSlot | null; // { kind: "jsonStorage"; records: JSONStorageRecord[] }
  tools: AgentToolsSlot | null;     // { native: string[]; mcp: string[]; skills: string[] }
}
```

`null` = an empty slot. `AgentSlotKind = "llm" | "storage" | "tools"`.

## Rendering

- [src/nodes/AgentNodeView.tsx](../src/nodes/AgentNodeView.tsx) — **presentational** card (no React-Flow deps): a centered icon+label header above the three **square** `SlotBox`es in a single row. Reused by both the canvas node and the drag ghost. Each slot box carries `data-agent-slot` / `data-agent-id` (drop hit-testing) and an `onSlotClick` (focus). Empty boxes show a dashed border + hint; filled boxes show the configured summary (provider·model / record count / tool count). Slot icons mirror the plugins they accept (`pluginRegistry.get("llm"|"jsonStorage"|"toolsContainer")`).
- [src/nodes/AgentNode.tsx](../src/nodes/AgentNode.tsx) — the React-Flow `component`: wraps `AgentNodeView` and supplies the input(left)/output(right) `<Handle>`s + `StatusBorder`. Status chrome mirrors `GenericNodeShell`.
- **Full-design drag ghost** — the palette card stays small, but while dragging *and* on drop the Agent shows its full design. [WorkspaceEditor.tsx](../src/components/WorkspaceEditor.tsx) special-cases `activeDragNode.type === "agent"` in the ghost render to draw `AgentNodeView`; the existing drop-centering measures the real `#drag-ghost-card` size, so it adapts automatically.

## Filling a slot

Three paths, all writing a slot into the agent's `data`. Compatibility: `llm`→LLM, `meta.category === "storage"`→Storage, `toolsContainer`→Tools (custom presets resolve via `baseType`). `buildAgentSlotValue` copies **only** slot-relevant config (LLM params / storage records / tool ids) — never transient run state.

1. **Drag from the palette** — [useWorkspaceDragDrop.ts](../src/hooks/useWorkspaceDragDrop.ts) `handleDrop`: before creating a free node, hit-tests the drop point against slot-box rects (`findAgentSlotByRect`) and fills the slot from the type's merged defaults instead of adding a node.
2. **Drag an existing canvas node onto a slot** — `handleNodeDragStop` (wired via React Flow `onNodeDragStart`/`onNodeDragStop`): copies the dragged node's config into the slot and **snaps the node back to its start position** — it is adopted as config, *not* nested or relocated; the source node stays on the canvas. Rect-based hit-testing is used here deliberately: the dragged node sits on top of the cursor, so `elementFromPoint` would return it, not the slot beneath.
3. **Click-to-configure** — clicking a slot box on the canvas requests focus through [src/nodes/agentSlotFocus.ts](../src/nodes/agentSlotFocus.ts) (a tiny bridge; parks the request if the inspector isn't mounted yet, delivers live otherwise), and the inspector scrolls that section into view.

## Inspector

[src/components/inspectors/AgentInspector.tsx](../src/components/inspectors/AgentInspector.tsx) renders three slot sections + a shared **Last Response** + Actions. Each slot is add/remove-able. Shared with the LLM node to avoid drift:

- [shared/LLMConfigFields.tsx](../src/components/inspectors/shared/LLMConfigFields.tsx) — provider/credential/model/params/history fields (also used by `LLMInspector`). Operates on a generic `values` + `onChange(fullBlob)` so it works on `node.data` (LLM node) or `node.data.llm` (agent slot).
- [shared/LastResponseSection.tsx](../src/components/inspectors/shared/LastResponseSection.tsx) — the output panel.
- [shared/ToolsSelector.tsx](../src/components/inspectors/shared/ToolsSelector.tsx) — the tools multi-select (also used by the Tools node inspector).

The LLM slot's default seed comes from [src/nodes/llmDefaults.ts](../src/nodes/llmDefaults.ts) (`LLM_DEFAULT_DATA`), a neutral module shared with `LLMPlugin` so there's no import cycle through the inspectors barrel.

## Execution

[src/engine/AgentExecutor.ts](../src/engine/AgentExecutor.ts) runs the agent like the LLM node, through the **shared inference path** [src/engine/llmInference.ts](../src/engine/llmInference.ts) (extracted from `LLMExecutor` — both now call it):

1. `resolveLlmConfig(data.llm)` + a credential guard (throws an actionable error if the slot or its credential is missing).
2. `resolveLlmInputMessages(ctx, historyLimit)` — upstream Chat conversation, else first upstream envelope value as a user message (cached on `lastInputMessages` for retries).
3. If the Tools slot has runnable tools **or the agent has a Storage slot** (which adds the built-in memory tools), runs the **tool-calling loop** (see [Tools](#tools)); otherwise `callLlm(config, messages, workspacePath)` — a pool-gated single inference returning the standard envelope.
4. Persists the storage slot's records — any `memory_save` writes made during the loop **plus** the final answer appended at the end (one write) — and writes `outputEnvelope` (with the tool trace on `data.toolTrace` when tools ran). Records use a collision-free `crypto.randomUUID()` id (the memory tools can write several per run).

**Connectivity:** `CONNECTION_RULES` in [src/engine/connectivity.ts](../src/engine/connectivity.ts) makes **Chat ↔ Agent bi-directional** (mirroring Chat ↔ LLM), so the Agent is a drop-in conversational unit. The Agent also has a normal output port, so connecting it to an external `jsonStorage` writes via the usual post-execution storage sync.

## Persistence

The agent is one node; everything lives in `data` (opaque JSON) and round-trips with the existing space file — **except** the storage slot's `records`, which are decoupled to `.hive/storage/<space_id>/<agentId>.json` to keep the space file small. [save_space / load_space](../src-tauri/src/commands/workspace.rs) gained an `"agent"` branch mirroring `jsonStorage`: it strips `data.storage.records` on save and reattaches on load (only when a storage slot is present).

## Tools

The Tools slot stores selected tool ids `{ native, mcp, skills }` (plus optional `toolSettings`). At runtime the agent offers the **runnable** ones to the model as function schemas and executes the calls it makes, feeding results back until a final answer or a per-agent iteration cap. **All** native built-ins, MCP servers, Skills, and user-defined HTTP/script tools are runnable.

- **Registry + picker.** [toolsService](../src/services/toolsService.ts) + [builtInTools.ts](../src/services/builtInTools.ts) are the scope-aware registry (built-in ⊕ global ⊕ workspace), persisted via Rust `load/save_{global,workspace}_tools` ([customization.rs](../src-tauri/src/commands/customization.rs)) at `app_data_dir/tools.json` / `.hive/tools.json` (`ToolsConfig` / `ToolDef` in `models.rs`). A `ToolDef` carries optional `mcp` / `http` / `script` sub-objects — the **disk-authoritative** execution config for each runnable kind. [ToolsSelector](../src/components/inspectors/shared/ToolsSelector.tsx) renders each category as a grid of cards; the dotted `＋` opens [ToolPickerMenu](../src/components/inspectors/shared/ToolPickerMenu.tsx) (add existing), which can branch to [ToolFormModal](../src/components/inspectors/shared/ToolFormModal.tsx); clicking a card opens that **same** `ToolFormModal`. **One modal, three modes** (derived from its `initial` prop + whether the def is a built-in): **create** (empty form, scope selectable), **edit** (a user tool on disk — full **in-place** editing of its HTTP/script/MCP/skill config, scope locked, Save → `toolsService.updateTool`), and **config** (a built-in — read-only details + a declaration-driven credential binding, e.g. Brave Web Search's key). Allowed-hosts (HTTP + script tools) use the shared [NetworkAllowlistEditor](../src/components/shared/NetworkAllowlistEditor.tsx) (None / Allow-all / Allowlist), the same control custom script *nodes* use. `isToolRunnable(category, def)` ([builtInTools.ts](../src/services/builtInTools.ts)) drives the card badges (`⚠ needs key/connection/setup`). The [ToolsPlugin](../src/nodes/plugins/ToolsPlugin.ts) `toolsContainer` node shares the selector, and the **Tools** section of `SettingsModal` ([ToolsPanel](../src/components/settings/ToolsPanel.tsx)) manages the registry (create/edit/delete across scopes) without a node on the canvas.
- **The dispatch core.** [agentTools.ts](../src/engine/agentTools.ts): `buildAgentTools(toolsSlot, workspacePath, { hasMemory })` resolves each selected tool into a tagged **`ResolvedTool`** keyed by the schema name offered to the model — `nativeBuiltin` · `mcp` · `httpTool` · `scriptTool` · `loadSkill` · `memory` — and returns `{ schemas, lookup, notes, skillCatalog }`. `executeToolCall` is a `switch` over that kind; it **always resolves** (a tool error returns `{ error }` so the model can recover). **Disk is authoritative for grants:** the renderer passes only ids + the model's arguments; Rust reads each tool's connection/HTTP/script config off disk by id (local-first: workspace shadows global). Credential-requiring built-ins (e.g. `web_search`) are network-bound, so they're pool-gated through the `general` pool like the MCP/HTTP/script kinds; `calculator`/`current_time` are pure compute and run ungated. **Which built-in needs a credential is declared once** in `BUILTIN_CREDENTIAL_REQUIREMENTS` ([builtInTools.ts](../src/services/builtInTools.ts)) — that single declaration drives the card badge, the config picker, and the pool-gating, so no built-in id is hardcoded across the surfaces.
- **Memory tools (the agent's own Storage).** When the agent has a **Storage slot** (`hasMemory`), `buildAgentTools` offers three built-in tools — `memory_save` (append a durable fact), `memory_search` (case-insensitive substring match, newest first), `memory_list` (recent entries) — independent of the Tools slot, so an agent can have memory with no other tools. They run **renderer-side** ([agentMemory.ts](../src/engine/agentMemory.ts)) over a working copy of the slot's `records` passed into the loop via `ExecuteToolOptions.memory`; `AgentExecutor` persists that array (memory writes + the final-answer append) in one write. The system prompt frames the slot as "your persistent memory that carries across runs" plus a short digest of recent entries, so the model knows the `memory_*` tools act on *its own* store.
- **Native built-ins** — `calculator` / `current_time` (hive-sandbox QuickJS, network off) + `web_search` (labelled **Brave Web Search**; the id stays `web_search`) (Brave, vault `webSearch` credential) via [run_native_tool](../src-tauri/src/commands/tools.rs). It binds its key through the unified `ToolFormModal`'s `CredentialPicker`, stored per-agent in `toolSettings.credentialIds` keyed by tool id (the legacy `toolSettings.webSearchCredentialId` is still read for back-compat).
- **MCP servers** — connect via the official **`rmcp`** SDK (stdio = a spawned child process; streamable HTTP). [commands/mcp.rs](../src-tauri/src/commands/mcp.rs) holds an `McpManager` in Tauri managed state that caches live sessions (keyed by scope+id+config, reconnecting on config change), with `mcp_list_tools` (discover) + `mcp_call_tool` (invoke). Discovered tools join `buildAgentTools` namespaced `mcp__<server>__<tool>` (provider-safe — OpenAI forbids `:` in tool names); `executeToolCall` dispatches `mcp` → `api.mcpCallTool`. The connection config (command/args/env or url/headers) lives in the `mcp` `ToolDef` on disk — the renderer never sends a command line. **Windows:** stdio servers are spawned through `cmd /c <command> …` (with `CREATE_NO_WINDOW`) so batch-shim launchers (`npx`, `npm`, `uvx`, …) resolve — `Command::new("npx")` can't execute a `.cmd` directly, which is why stdio MCP servers previously failed to start on Windows. **Secrets via the vault:** an `mcp` `ToolDef` may carry a `credentialId` (+ `credentialEnv` for stdio, `credentialPrefix` for the http `Authorization` header); `ensure_connected` resolves it from the vault (`resolve_credential_values`, `apiKey` field) and injects it **only at connect time**, keeping the plaintext out of `tools.json` and the session cache key (which is derived from the on-disk config). Mirrors the HTTP-tool credential pattern; the picker lives in [McpConnectionFields](../src/components/inspectors/shared/McpConnectionFields.tsx).
- **Skills (progressive disclosure)** — skill metadata lives in `tools.json` `skills[]`; the `SKILL.md` instruction body lives at `<scope>/skills/<id>/SKILL.md`. `buildAgentTools` injects a short catalog (`id — description`) into the system prompt and offers **one** `load_skill` tool (an `enum` of the selected skill ids); `executeToolCall` validates the requested id ∈ selection and returns the body via `load_skill_content` ([customization.rs](../src-tauri/src/commands/customization.rs)). Bodies are edited inline in `ToolFormModal` (`save_skill_content`) or revealed for a BYO editor (`open_skill_instructions`).
- **User native tools (HTTP + script)** — a `native` `ToolDef` with `http` config runs via [run_http_tool](../src-tauri/src/commands/tools.rs) (`{{arg}}`-templated url/headers/body, vault credential injected, SSRF-guarded through the shared **`hive_sandbox::http_request`**); one with `script` config runs its `<scope>/tools/<id>/script.js` via [run_tool_script](../src-tauri/src/commands/tools.rs) — the same QuickJS sandbox as custom script nodes, via [commands/sandbox_support.rs](../src-tauri/src/commands/sandbox_support.rs) (the extracted vault resolver + run entry point). Authored in `ToolFormModal` (HTTP|Script toggle + a params builder ([ToolParamsEditor](../src/components/inspectors/shared/ToolParamsEditor.tsx)) + grants); `script.js` is seeded + revealed via `open_tool_script`.
- **The agent loop** ([AgentExecutor.ts](../src/engine/AgentExecutor.ts)): `buildAgentTools` → compose system prompt (base ⊕ memory framing + digest ⊕ **skills catalog** ⊕ tool guidance) → if no schemas, a single `callLlm`; else loop: `callLlmWithTools` → run requested tools (MCP/HTTP/script/web_search gated through the concurrency governor's `general` pool) → feed `{role:"tool",…}` results back → repeat. The round cap is a per-agent **toggle** (`toolSettings.limitToolRounds`, **on by default**): on → `maxIterations` clamped to `[1, MAX_AGENT_ITERATIONS_CEIL]` (default `MAX_AGENT_ITERATIONS = 10`, `MAX_AGENT_ITERATIONS_CEIL = 25`); off → **unbounded** (`Infinity`) — the loop runs until the model stops calling tools or the run is cancelled. To keep that safe, the loop polls `ExecutionContext.isCancelled()` at the top of each round (wired from the run loop's per-run cancel flag), so **Stop** halts an in-flight agent; the inspector warns about cost when the limit is off. Final answer → `outputEnvelope.value`; structured trace → `outputEnvelope.data.toolTrace` + `metadata.iterations`; human-readable run log → transient `node.data.logs` (the always-visible **Logs** section in the inspector reads either). The final answer is appended to the Storage slot.
- **Provider tool wire-format is Rust-side.** `llm_chat_tools` ([commands/llm.rs](../src-tauri/src/commands/llm.rs)) accepts `ToolSchema[]` + `AgentChatMessage[]` and returns a provider-neutral `AgentChatResponse`, translating to/from OpenAI / Anthropic / Ollama. Unchanged by this work.

**Deferred:** streaming token output; executing skill-bundled scripts; richer memory backends than the JSON record log (the `kind` field is open for postgres/sqlite/etc.).

## Key files

| Concern | Files |
|---|---|
| Data model | `src/nodes/types.ts`, `src/nodes/llmDefaults.ts` |
| Rendering | `src/nodes/AgentNode.tsx`, `src/nodes/AgentNodeView.tsx`, `src/nodes/agentSlotFocus.ts` |
| Plugin | `src/nodes/plugins/AgentPlugin.ts`, `src/nodes/plugins/ToolsPlugin.ts` |
| Inspector | `src/components/inspectors/AgentInspector.tsx`, `.../shared/{LLMConfigFields,LastResponseSection,ToolsSelector,ToolPickerMenu,ToolFormModal,McpConnectionFields,ToolParamsEditor}.tsx`, `.../ToolsInspector.tsx`, `src/components/shared/NetworkAllowlistEditor.tsx` |
| Execution | `src/engine/AgentExecutor.ts`, `src/engine/agentTools.ts`, `src/engine/agentMemory.ts`, `src/engine/llmInference.ts`, `src/engine/connectivity.ts` |
| Settings | `src/components/settings/ToolsPanel.tsx` (tool/MCP/skill registry), `src/components/settings/SettingsModal.tsx` |
| Drag/drop | `src/hooks/useWorkspaceDragDrop.ts`, `src/components/WorkspaceEditor.tsx` |
| Tools registry | `src/services/toolsService.ts`, `src/services/builtInTools.ts`, `src-tauri/src/commands/customization.rs` (tools + skills IPC), `src-tauri/src/models.rs` |
| Tool runtime | `src-tauri/src/commands/llm.rs` (`llm_chat_tools`), `.../tools.rs` (`run_native_tool` / `run_http_tool` / `run_tool_script` / `open_tool_script`), `.../mcp.rs` (`rmcp` client + `McpManager`), `.../sandbox_support.rs`, `src-tauri/crates/sandbox` (`http_request`) |
| Persistence | `src-tauri/src/commands/workspace.rs` |
| Tests | `src/engine/__tests__/agentExecutor.test.ts`, `.../agentTools.test.ts`, `.../connectivity.test.ts` |
