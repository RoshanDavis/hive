# Agent Node

> **📌 Living document — current design, not a contract.** Describes the *intended* design as of **2026-06-02** (commit `8e6fc26` + the native tool-calling and card-based Tools UI work on `feat/agent-node`). The code is the source of truth: **if this doc and the code disagree, trust the code and fix the doc.** Detect drift by diffing the paths under [Key files](#key-files) since that commit, e.g. `git log --oneline 8e6fc26..HEAD -- src/engine/AgentExecutor.ts src/engine/agentTools.ts src/components/inspectors/shared/ToolsSelector.tsx src-tauri/src/commands/llm.rs`.

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
3. If the Tools slot has runnable tools, runs the **tool-calling loop** (see [Tools](#tools)); otherwise `callLlm(config, messages, workspacePath)` — a pool-gated single inference returning the standard envelope.
4. Appends the final answer to the storage slot (a memory log, mirroring the engine's post-exec storage record shape) and writes `outputEnvelope` (with the tool trace on `data.toolTrace` when tools ran).

**Connectivity:** `CONNECTION_RULES` in [src/engine/connectivity.ts](../src/engine/connectivity.ts) makes **Chat ↔ Agent bi-directional** (mirroring Chat ↔ LLM), so the Agent is a drop-in conversational unit. The Agent also has a normal output port, so connecting it to an external `jsonStorage` writes via the usual post-execution storage sync.

## Persistence

The agent is one node; everything lives in `data` (opaque JSON) and round-trips with the existing space file — **except** the storage slot's `records`, which are decoupled to `.hive/storage/<space_id>/<agentId>.json` to keep the space file small. [save_space / load_space](../src-tauri/src/commands/workspace.rs) gained an `"agent"` branch mirroring `jsonStorage`: it strips `data.storage.records` on save and reattaches on load (only when a storage slot is present).

## Tools

The Tools slot stores selected tool ids `{ native, mcp, skills }` (plus optional `toolSettings`). At runtime the agent offers the **runnable** ones to the model as function schemas and executes the calls it makes, feeding results back until a final answer or an iteration cap.

- **Registry + picker.** [src/services/toolsService.ts](../src/services/toolsService.ts) + [builtInTools.ts](../src/services/builtInTools.ts) are the scope-aware registry (built-in ⊕ global ⊕ workspace), persisted via Rust `load/save_{global,workspace}_tools` ([customization.rs](../src-tauri/src/commands/customization.rs)) at `app_data_dir/tools.json` / `.hive/tools.json` (`ToolsConfig` in `models.rs`). [ToolsSelector](../src/components/inspectors/shared/ToolsSelector.tsx) renders each category as a grid of square cards (reusing `NodeGridCard` / `DashedAddCard`): a dotted `＋` card opens [ToolPickerMenu](../src/components/inspectors/shared/ToolPickerMenu.tsx) to add an existing tool or "create your own" via [ToolFormModal](../src/components/inspectors/shared/ToolFormModal.tsx); clicking a tool card opens [ToolConfigModal](../src/components/inspectors/shared/ToolConfigModal.tsx) (per-tool config + remove), and hovering reveals a ✕ to deselect. The [ToolsPlugin](../src/nodes/plugins/ToolsPlugin.ts) `toolsContainer` node (droppable onto the slot) shares the same selector. Non-runnable selections (user-created native tools, MCP, skills) show a "not runnable yet" badge.
- **Scope today: built-in native tools only.** The three built-ins — `calculator`, `current_time`, `web_search` — carry a JSON-Schema `parameters` def and have real implementations. User-added native tools and all MCP servers / skills are **selected/persisted but not yet invoked**: `buildAgentTools` filters them out of what's offered to the model and records a note in the run log (MCP and Skills are separate follow-ups).
- **The agent loop** lives in [AgentExecutor.ts](../src/engine/AgentExecutor.ts) + [agentTools.ts](../src/engine/agentTools.ts), on top of the shared inference path:
  1. `buildAgentTools(data.tools, workspacePath)` → model-ready `ToolSchema[]` + a name→def lookup (+ skip notes). If empty, the agent runs a single `callLlm` (the unchanged no-tools path).
  2. Compose the system prompt: LLM slot `systemPrompt` ⊕ a digest of recent Storage records (memory fed back into context) ⊕ brief tool-use guidance.
  3. Loop (cap `MAX_AGENT_ITERATIONS`): `callLlmWithTools` (pool-gated, one turn) → if the model returns `tool_calls`, run each via `executeToolCall` → `api.runNativeTool` (server-side) → append `{role:"tool",…}` results → repeat; else the turn's text is the final answer. Exhausting the cap returns the last text + a note.
  4. Write the final answer to `outputEnvelope.value`; record the structured trace on `outputEnvelope.data.toolTrace` + `metadata.iterations`, and a human-readable run log on the transient `node.data.logs` (the inspector's **Tool Activity** section reads either). Append the final answer to the Storage slot as before.
- **Provider tool wire-format is Rust-side.** `llm_chat_tools` ([commands/llm.rs](../src-tauri/src/commands/llm.rs)) is `llm_chat`'s tool-calling sibling: it accepts `ToolSchema[]` + a richer `AgentChatMessage[]` (assistant tool-call turns + tool-result messages) and returns a provider-neutral `AgentChatResponse { content, tool_calls, finish_reason }`, translating to/from OpenAI `tools`/`tool_calls`, Anthropic `tools`/`tool_use`, and Ollama `tools`. Plain `llm_chat` is unchanged; credentials stay server-side.
- **Native execution is server-side.** `run_native_tool` ([commands/tools.rs](../src-tauri/src/commands/tools.rs)) runs `calculator`/`current_time` inside the audited `hive_sandbox` QuickJS runtime with **network disabled** (no new dependency), and `web_search` as a direct **Brave Search** call with the user's key resolved from the vault (`X-Subscription-Token` header). The renderer only supplies the tool id + arguments (+ the bound credential id for web_search).
- **web_search credential (BYO).** `ToolsPlugin` declares a `webSearch` `CredentialSchema` (provider "Brave"); clicking the web_search card opens `ToolConfigModal`, whose `CredentialPicker` binds a key (the card shows a "⚠ needs key" badge until then). Stored as `tools.toolSettings.webSearchCredentialId` and resolved Rust-side at call time.

**Deferred (separate PRs):** a real MCP client (stdio / HTTP transports) and Skills execution. Selecting MCP servers / skills persists + displays them but does not invoke them yet.

## Key files

| Concern | Files |
|---|---|
| Data model | `src/nodes/types.ts`, `src/nodes/llmDefaults.ts` |
| Rendering | `src/nodes/AgentNode.tsx`, `src/nodes/AgentNodeView.tsx`, `src/nodes/agentSlotFocus.ts` |
| Plugin | `src/nodes/plugins/AgentPlugin.ts`, `src/nodes/plugins/ToolsPlugin.ts` |
| Inspector | `src/components/inspectors/AgentInspector.tsx`, `.../shared/{LLMConfigFields,LastResponseSection,ToolsSelector,ToolPickerMenu,ToolFormModal,ToolConfigModal}.tsx`, `.../ToolsInspector.tsx` |
| Execution | `src/engine/AgentExecutor.ts`, `src/engine/agentTools.ts`, `src/engine/llmInference.ts`, `src/engine/connectivity.ts` |
| Drag/drop | `src/hooks/useWorkspaceDragDrop.ts`, `src/components/WorkspaceEditor.tsx` |
| Tools registry | `src/services/toolsService.ts`, `src/services/builtInTools.ts`, `src-tauri/src/commands/customization.rs`, `src-tauri/src/models.rs` |
| Tool runtime | `src-tauri/src/commands/llm.rs` (`llm_chat_tools`), `src-tauri/src/commands/tools.rs` (`run_native_tool`) |
| Persistence | `src-tauri/src/commands/workspace.rs` |
| Tests | `src/engine/__tests__/agentExecutor.test.ts`, `.../agentTools.test.ts`, `.../connectivity.test.ts` |
