# Workflow Execution (the run loop)

> **📌 Living document — current design, not a contract.** Describes the *intended* design as of **2026-05-28** (commit `c748831`). The code is the source of truth: **if this doc and the code disagree, trust the code and fix the doc.** Detect drift by diffing the paths under [Key files](#key-files) since that commit, e.g. `git log --oneline c748831..HEAD -- src/hooks/useWorkspaceRunner.ts`.

This is the most intricate code in the app. [src/hooks/useWorkspaceRunner.ts](../src/hooks/useWorkspaceRunner.ts) owns *when* nodes run, how their visual status changes, how a run pauses for chat input, and how runs are cancelled and retried. *How a single node runs* is the engine's job — see [node-engine.md](node-engine.md).

## Vocabulary

- **Start nodes** — where a run begins. Either Trigger nodes (no executor) for a full run, or a single node for a Chat send / retry.
- **`runId`** — `"<counter>-<timestamp>"`, unique per run. Stamped onto every node this run touches (`node.data.statusRunId`) so cleanup never clobbers a *different* run's borders. Multiple runs can be live at once.
- **`startKey`** — `startNodeIds.join(",")`, identifies a workflow's start signature; used to track re-execution history across retries.
- **visited set** — node ids already executed in this run. Normally a node runs at most once; pause-capable nodes are the exception.
- **status** — `executing` / `success` / `error` / `waiting` / `pending` / `undefined`, rendered as the node's border color.

## Entry points

All three funnel into `runWorkflow(startNodeIds, chatInput?)`:

- `executeWorkflow(triggerNodeId?)` — start from Trigger nodes (all of them, or one if given). A full fresh run.
- `handleChatSend(nodeId, text)` — the user sent a chat message; start from that Chat node with `chatInput = text`.
- `retryWorkflow(nodeId)` — re-run starting from a given node.

## The run loop, step by step

```
runWorkflow(startNodeIds, chatInput?)
  1. allocate runId; mark workflow "running" (startKey)
  2. compute graph relationships (excluding storage edges):
       reachableDownstreamIds = getReachableNodeIds(startNodeIds, edges)
       ancestorIds            = getAncestorNodeIds(startNodeIds, edges)
       startingStorageNodeIds = storage nodes hanging off start nodes
  3. classify each node: in-scope? (start | reachable | starting-storage)
       seed in-scope nodes to "pending"; leave out-of-scope nodes untouched
  4. seed the visited set from prior history (retry re-seeding, see below)
  5. BFS from startNodeIds:
       while queue not empty and not cancelled:
         pop currentId; skip if visited (unless canPauseWorkflow)
         set status "executing"; await 600ms (visual beat)
         executeNode(...)                       // engine runs the node
         decide status + whether to propagate / pause
         enqueue downstream non-storage targets
  6. finally: toast result; schedule fade-out or tear down on cancel
```

### Reachability (storage edges excluded)

`getReachableNodeIds` BFS-walks *forward* from the start nodes; `getAncestorNodeIds` walks *backward*. Both **ignore storage edges** (`sourceHandle`/`targetHandle === "storage"`) and both treat a `bi-directional` edge as traversable in the reverse direction too. Ancestors matter for two things: re-seeding already-successful upstream nodes on a retry, and recognizing a pause node reached via a loop-back as a *return path* rather than a fresh halt.

### Scope and initial status

A node is **in scope** if it's a start node, a storage node hanging off a start node, or reachable downstream. In-scope nodes are reset to `pending` (blue) at run start; **out-of-scope nodes are left completely untouched** — including their status and `statusRunId` — so a second concurrent run never disturbs another run's borders.

On a **fresh run** (`hasTriggerStart || chatInput`), transient input caches (`lastInputMessages`, `lastInputText`, `lastInputSender`, `lastInputEnvelope`) are cleared so nodes recompute from scratch.

### `localUpdateNodeData` and `applyStatus`

The loop keeps a local working copy `currentNodes` and writes through `localUpdateNodeData`, which (a) updates the local copy, (b) mirrors status onto a pause-capable node's connected storage node, and (c) forwards to the real React state via `handleUpdateNodeData`. `applyStatus` is the thin wrapper that also stamps `statusRunId`. Stamping is what makes multi-run cleanup safe.

### The visited rule and pause-capable nodes

Normally a visited node is skipped. The exception: a plugin with `canPauseWorkflow` (Chat) may **re-enter as a downstream receiver** — that's how a Chat node both *starts* a run (user message) and later *receives* the LLM's reply on the bi-directional edge.

### Status decisions after a node runs

- **Pause-capable node reached as a receiver** (not the starting node): is this a *return path* or a *forward halt*?
  - **Return path** (→ `success`, continue): it already ran this run (`isVisited`), or it's an ancestor of the start (loop-back), or a bi-directional edge points to an already-executed node. The cycle closes.
  - **Forward halt** (→ `waiting`, yellow): otherwise the run *pauses here* awaiting user input. `haltedAtChat = true`.
- **Starting pause node or regular node** (→ `success`): with one nuance — a pause-capable starting node that has a bi-directional edge is set to `pending` (blue) to show it's awaiting its reply.
- **Throw** (→ `error`, red): status set with the error message, then re-thrown to abort the run.

### Propagation

After a node succeeds, downstream targets are enqueued — forward edges, plus bi-directional edges back toward the source — **excluding** any edge touching a storage node or a storage handle. Storage writes are not part of logic flow; they happen via the engine's storage-sync step and the Chat executor.

### The 600 ms beat

Each node waits 600 ms in `executing` before running, purely so the user can see the workflow light up node-by-node. Cancellation is checked before and after this delay and after the `await executeNode`.

## Status lifecycle and the fade

```
        (run start, in-scope)            (executing)
   ─────────────────────────▶ pending ───────────────▶ executing
                                                            │
                         ┌──────────────┬──────────────────┼───────────────┐
                         ▼              ▼                   ▼               ▼
                      success        waiting             pending         error
                    (green)         (yellow, awaiting    (blue, chat     (red)
                         │           user input)          awaiting reply)  │
                         │                                                 │
          after FADE_DELAY_MS (1500ms): success/pending/executing ─▶ undefined (fade out)
                         error and waiting are KEPT (not faded)
```

When the loop ends (success or error), a `FADE_DELAY_MS` (1500 ms) timer clears the borders of nodes this run still owns — but **`error` and `waiting` are preserved** (a red error and a yellow "awaiting input" should linger). Fade timers are keyed by `runId` so a stale timer can never clear a newer run's nodes.

## Cancellation

`cancelWorkflow(nodeId?)` — with a `nodeId`, cancels just the run that owns that node; otherwise cancels every active run. Each run has a `RunControl { startKey, cancelled, inLoop }`:

- Set `cancelled = true`. The loop checks `isCancelled(runId)` at each step and breaks.
- If the loop already exited (it's in its fade window, `inLoop === false`), tear the run down immediately; otherwise the loop's `finally` block cleans up when it next sees the flag.
- Borders for cancelled runs are cleared right away (including `error`/`waiting`, since a cancel is a hard stop).

## Retry and re-execution history

`executedNodeIdsMapRef` tracks, per `startKey`, which nodes have run. On a retry-from-a-node (not a Trigger start):

- All reachable downstream nodes are removed from history so they re-execute freshly with the new signal.
- Successful **ancestors** are *added* to history (and the visited set) so they are treated as already-done and reused rather than re-run.

A Trigger start clears the history for that `startKey` entirely — a clean slate.

## Pause / resume worked example (Chat ↔ LLM, bi-directional)

1. User types in Chat and sends → `handleChatSend(chatId, text)` → `runWorkflow([chatId], text)`.
2. Chat runs as the *starting* pause node (gets `chatInput`), writes the user message, and — having a bi-directional edge — is set to `pending`.
3. BFS propagates to LLM. LLM reads the Chat history, calls the model, writes its reply.
4. BFS propagates back to Chat (a bi-directional edge). Chat re-enters as a *receiver*. Because it already ran (`isVisited`), this is a **return path** → Chat goes `success`, the reply is appended, the cycle ends.
5. A Trigger→Chat run with no message instead **halts** at Chat (`waiting`) until the user sends — the forward-halt path.

## Key files

- [src/hooks/useWorkspaceRunner.ts](../src/hooks/useWorkspaceRunner.ts) — the entire run loop, cancel, retry, fade.
- [src/engine/index.ts](../src/engine/index.ts) — `executeNode` (called per node).
- [src/engine/ChatExecutor.ts](../src/engine/ChatExecutor.ts) — the canonical `canPauseWorkflow` node; input vs. receiver modes.
- [src/engine/LLMExecutor.ts](../src/engine/LLMExecutor.ts) — reads chat history / upstream input; concurrency-pooled.
- [src/nodes/StatusBorder.tsx](../src/nodes/StatusBorder.tsx) — renders the status colors.
