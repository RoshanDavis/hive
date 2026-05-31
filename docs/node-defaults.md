# Node Defaults (global + per-workspace)

> **📌 Living document — current design, not a contract.** Describes the *intended* design as of **2026-05-31** (commit `0b50083`). The code is the source of truth: **if this doc and the code disagree, trust the code and fix the doc.** Detect drift by diffing the paths under [Key files](#key-files) since that commit, e.g. `git log --oneline 0b50083..HEAD -- src/services/nodeDefaultsService.ts src/contexts/NodeDefaultsContext.tsx`.

A new node starts from its plugin's `defaultData`. Node defaults let users override that starting config at two scopes — global and per-workspace — so repeated setup (provider/model/credential, etc.) isn't retyped for every node.

## The three-layer merge

At **node-create time** the starting data is a shallow merge:

```
plugin.defaultData  ◀──  globalDefaults[type]  ◀──  workspaceDefaults[type]
       (base)             (machine-wide)             (this workspace; wins)
```

> **Important:** defaults only affect **newly created** nodes. Changing a default never rewrites existing nodes — they keep the data they were created with.

The merge happens in exactly one place per add-path, both reading `getMergedOverrides(type)` from the context:

- `WorkspaceEditor.handleAddNode`
- `useWorkspaceDragDrop` (drag from palette)

## Storage

| Scope | File | Shape |
|---|---|---|
| Global | `app_data_dir/node-defaults.json` | `{ version, defaults, models }` |
| Workspace | `<workspace>/.hive/node-defaults.json` | same |

`defaults` is `Record<pluginType, Partial<nodeData>>`; `models` is `Record<provider, ModelEntry[]>` (user-added LLM models). A missing file returns an empty config — no migration needed. Rust commands: `load/save_global_node_defaults` and `load/save_workspace_node_defaults` ([commands/customization.rs](../src-tauri/src/commands/customization.rs)); the struct is `NodeDefaultsConfig` ([models.rs](../src-tauri/src/models.rs)).

## Service + context (single source of truth)

- [src/services/nodeDefaultsService.ts](../src/services/nodeDefaultsService.ts) is the façade: an in-memory cache (global + per-workspace-path), scope-aware get/set/clear, model add/remove, and `getMergedOverrides(type, workspacePath)`.
- [src/contexts/NodeDefaultsContext.tsx](../src/contexts/NodeDefaultsContext.tsx) wraps the workspace tree and is **the single source of truth the add-paths read**. It only re-pulls global defaults on workspace (re)mount.

> **Convention:** read merged defaults at create time through `useNodeDefaults().getMergedOverrides` — never the service directly in render. After editing defaults, call the context `refresh()` so changes apply without a workspace reload.

## Editors

A plugin may declare a `defaultsEditor` — a lightweight `DefaultsEditorProps` component with no Run/chat/last-response UI (distinct from the full `inspector`):

- `LLMPlugin` → [src/components/defaults/LLMDefaultsEditor.tsx](../src/components/defaults/LLMDefaultsEditor.tsx).
- Plugins without one fall back to [AutoDefaultsEditor](../src/components/defaults/AutoDefaultsEditor.tsx), which auto-generates inputs from `defaultData` keys.
- [DefaultsEditorModal](../src/components/defaults/DefaultsEditorModal.tsx) hosts the editor and persists via the service.

`DefaultsEditorProps.workspacePath` is `null` at global scope, set inside a workspace; `scope` tells the editor which it's editing.

## Surfaces

- **Global** defaults are edited on the landing-page **Nodes tab** ([src/components/NodesPage.tsx](../src/components/NodesPage.tsx), a Dashboard nav item). This is also where global *custom nodes* are managed.
- **Workspace** defaults are edited in the **Node Defaults** section of `SettingsModal` ([src/components/settings/NodeDefaultsPanel.tsx](../src/components/settings/NodeDefaultsPanel.tsx)) — it shows only overridden node types as cards, plus a `+` picker to add one.

Reusable card/picker/search UI is shared with the custom-node surfaces: [NodeGridCard](../src/components/shared/NodeGridCard.tsx), [DashedAddCard](../src/components/shared/DashedAddCard.tsx), [NodePickerMenu](../src/components/shared/NodePickerMenu.tsx), [rankedSearch](../src/utils/rankedSearch.ts).

## The LLM model picker

The LLM model field is a dropdown ([ModelPicker](../src/components/inspectors/shared/ModelPicker.tsx)), not free text. It groups ⭐ built-in ([builtInModels](../src/services/builtInModels.ts)) / 🌐 global / 📁 workspace user models, with an inline "Add new" + scope toggle (mirroring the credential picker). User models persist in the `models` map of the node-defaults file. In `LLMDefaultsEditor`, default credentials are allowed (stores only `credentialId`); at global scope only global credentials are offered.

Shared LLM provider config (`ProviderType`, `PROVIDER_BASE_URL`, `PROVIDER_SCHEMA_TYPES`) lives in [src/services/llmProviders.ts](../src/services/llmProviders.ts) and is used by both `LLMInspector` and `LLMDefaultsEditor` — keep it there, not duplicated.

## Adding a defaults editor to a node type

Set `defaultsEditor` on the plugin, or rely on `AutoDefaultsEditor`. No other wiring is needed — the Nodes tab, the settings panel, the pickers, and ranked search all consume the registry generically.

## Key files

- [src/services/nodeDefaultsService.ts](../src/services/nodeDefaultsService.ts) — cache + merge + model CRUD.
- [src/contexts/NodeDefaultsContext.tsx](../src/contexts/NodeDefaultsContext.tsx) — the add-path source of truth.
- [src/components/defaults/](../src/components/defaults/) — editors + modal.
- [src/components/NodesPage.tsx](../src/components/NodesPage.tsx), [src/components/settings/NodeDefaultsPanel.tsx](../src/components/settings/NodeDefaultsPanel.tsx) — surfaces.
- [src/services/builtInModels.ts](../src/services/builtInModels.ts), [src/services/llmProviders.ts](../src/services/llmProviders.ts) — model + provider config.
- [src-tauri/src/commands/customization.rs](../src-tauri/src/commands/customization.rs), [src-tauri/src/models.rs](../src-tauri/src/models.rs) — persistence.
