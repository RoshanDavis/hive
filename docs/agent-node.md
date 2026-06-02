# Agent Node

> **📌 Living document — current design, not a contract.** Describes the *intended* design as of **2026-06-02** (commit `a55f490`, the `feat/agent-node` work). The code is the source of truth: **if this doc and the code disagree, trust the code and fix the doc.** Detect drift by diffing the paths under [Key files](#key-files) since that commit, e.g. `git log --oneline a55f490..HEAD -- src/nodes/AgentNode.tsx src/engine/AgentExecutor.ts`.

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
3. `callLlm(config, messages, workspacePath)` — pool-gated single inference returning the standard envelope.
4. Appends the result to the storage slot (a memory log, mirroring the engine's post-exec storage record shape) and writes `outputEnvelope`.

**Connectivity:** `CONNECTION_RULES` in [src/engine/connectivity.ts](../src/engine/connectivity.ts) makes **Chat ↔ Agent bi-directional** (mirroring Chat ↔ LLM), so the Agent is a drop-in conversational unit. The Agent also has a normal output port, so connecting it to an external `jsonStorage` writes via the usual post-execution storage sync.

## Persistence

The agent is one node; everything lives in `data` (opaque JSON) and round-trips with the existing space file — **except** the storage slot's `records`, which are decoupled to `.hive/storage/<space_id>/<agentId>.json` to keep the space file small. [save_space / load_space](../src-tauri/src/commands/workspace.rs) gained an `"agent"` branch mirroring `jsonStorage`: it strips `data.storage.records` on save and reattaches on load (only when a storage slot is present).

## Tools (scaffolding — runtime invocation deferred)

The Tools subsystem is **configured + persisted today; not yet invoked at runtime.**

- [src/nodes/plugins/ToolsPlugin.ts](../src/nodes/plugins/ToolsPlugin.ts) — a `toolsContainer` node (also droppable onto an agent's Tools slot) with [ToolsInspector](../src/components/inspectors/ToolsInspector.tsx).
- [src/services/toolsService.ts](../src/services/toolsService.ts) + [builtInTools.ts](../src/services/builtInTools.ts) — scope-aware registry of native tools / MCP servers / skills (built-in ⊕ global ⊕ workspace), mirroring `nodeDefaultsService`. Persisted via Rust `load/save_{global,workspace}_tools` ([customization.rs](../src-tauri/src/commands/customization.rs)) at `app_data_dir/tools.json` and `.hive/tools.json` (`ToolsConfig` in `models.rs`).
- The agent's Tools slot stores selected ids `{ native, mcp, skills }`.

**Deferred (NOT in this branch):** the LLM function-calling round-trip — extending the Rust `llm_chat` command + provider request/response shapes to pass tool schemas and handle tool-call turns, a real MCP client, and skills execution. `AgentExecutor` has a `TODO(tools)` where the tool loop will go; until then configured tools persist and display but are not passed to the model.

## Key files

| Concern | Files |
|---|---|
| Data model | `src/nodes/types.ts`, `src/nodes/llmDefaults.ts` |
| Rendering | `src/nodes/AgentNode.tsx`, `src/nodes/AgentNodeView.tsx`, `src/nodes/agentSlotFocus.ts` |
| Plugin | `src/nodes/plugins/AgentPlugin.ts`, `src/nodes/plugins/ToolsPlugin.ts` |
| Inspector | `src/components/inspectors/AgentInspector.tsx`, `.../shared/{LLMConfigFields,LastResponseSection,ToolsSelector}.tsx`, `.../ToolsInspector.tsx` |
| Execution | `src/engine/AgentExecutor.ts`, `src/engine/llmInference.ts`, `src/engine/connectivity.ts` |
| Drag/drop | `src/hooks/useWorkspaceDragDrop.ts`, `src/components/WorkspaceEditor.tsx` |
| Tools registry | `src/services/toolsService.ts`, `src/services/builtInTools.ts`, `src-tauri/src/commands/customization.rs`, `src-tauri/src/models.rs` |
| Persistence | `src-tauri/src/commands/workspace.rs` |
| Tests | `src/engine/__tests__/agentExecutor.test.ts`, `.../connectivity.test.ts` |
