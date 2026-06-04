import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceConfig, SpaceData } from "@/types/workspace";
import type { CustomNodeDefinition, CustomNodeScope } from "@/types/customNodes";
import type { NodeOutputEnvelope } from "@/engine/types";
import type {
  CredentialMeta,
  CredentialScope,
  CredentialValues,
} from "@/types/credentialTypes";

export interface ScriptRunResult {
  output: NodeOutputEnvelope;
  logs: string[];
}

// ─── Tauri Return Models ─────────────────────────────────────
export interface Workspace {
  name: string;
  path: string;
  is_initialized: boolean;
  // When true, workflows in this workspace keep running after the user
  // navigates back to the Dashboard. Defaults to true for new and
  // pre-existing workspaces (serde default on the Rust side).
  background_execution: boolean;
}

/** Per-workspace status rollup aggregated across every space in
 * `.hive/config.json`. Returned by `getWorkspaceStatusRollups`. */
export interface WorkspaceStatusRollup {
  path: string;
  has_error: boolean;
  has_waiting: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  sender?: string;
}

export interface ModelEntry {
  name: string;
  added_at: string;
}

export interface NodeDefaultsConfig {
  version: number;
  defaults: Record<string, Record<string, unknown>>;
  models: Record<string, ModelEntry[]>;
}

/** MCP server connection config, persisted on disk in the tools.json `mcp[]`
 * entry. The renderer never sends a command line — Rust reads this off disk by
 * id and spawns/connects to the server itself (disk is authoritative for grants). */
export interface McpServerConfig {
  transport: "stdio" | "http";
  /** stdio transport: executable + args + extra environment. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http (streamable) transport: endpoint URL + optional static headers. */
  url?: string;
  headers?: Record<string, string>;
  /** Vault credential id, resolved + injected server-side at connect time (kept out
   * of plaintext in tools.json). http → a header; stdio → an env var. */
  credentialId?: string;
  /** http: header to inject the credential into (default Authorization). */
  credentialHeader?: string;
  /** http: value prefix for the injected credential (default "Bearer "). */
  credentialPrefix?: string;
  /** stdio: environment variable name to inject the credential into. */
  credentialEnv?: string;
}

/** Declarative HTTP tool (a user-created native tool). Executed server-side via
 * the SSRF-guarded fetch with a vault credential injected. Model arguments are
 * substituted into `{{arg}}` placeholders; leftover args become the body/query. */
export interface HttpToolConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Optional request-body template (`{{arg}}` substituted). */
  bodyTemplate?: string;
  /** Vault credential id, resolved + injected server-side. */
  credentialId?: string;
  /** Header name / value prefix for the injected credential (default Authorization / "Bearer "). */
  credentialHeader?: string;
  credentialPrefix?: string;
  /** SSRF allowlist host globs; defaults to the url's host. */
  allow?: string[];
}

/** Sandboxed-script tool (a user-created native tool). The JS body lives on disk
 * at `<scope>/tools/<id>/script.js`; only the capability grants are persisted here
 * (mirrors a Tier-3 custom script node). */
export interface ScriptToolConfig {
  runtime?: "js";
  entry?: string;
  network?: { mode: "none" | "allowlist"; allow: string[] };
  credentials?: string[];
  limits?: { timeoutMs: number; memoryBytes: number };
}

/** A selectable tool / MCP server / skill the Agent's Tools slot can reference.
 * `parameters` is the JSON Schema for the tool's call signature, passed to the
 * model when the tool is offered (absent for selection-only entries). The
 * `mcp`/`http`/`script` sub-objects carry the (disk-authoritative) execution
 * config for each runnable kind; which one is present determines the kind. */
export interface ToolDef {
  id: string;
  label: string;
  description?: string;
  parameters?: Record<string, unknown>;
  /** Emoji/icon shown on the tool card. Falls back to a per-category icon. */
  icon?: string;
  /** MCP server connection (mcp-category entries). */
  mcp?: McpServerConfig;
  /** Declarative HTTP endpoint (native-category user tools). */
  http?: HttpToolConfig;
  /** Sandboxed JS body (native-category user tools). */
  script?: ScriptToolConfig;
}

export interface ToolsConfig {
  version: number;
  native: ToolDef[];
  mcp: ToolDef[];
  skills: ToolDef[];
}

// ─── Agentic chat (tool-calling) ─────────────────────────────
// Wire shapes for `llm_chat_tools`. Field names are snake_case to match the Rust
// serde structs (nested payloads aren't subject to Tauri's top-level key casing).

export interface ToolCall {
  id: string;
  name: string;
  /** The model's function-call arguments as a JSON string. */
  arguments: string;
  /** Opaque provider passthrough echoed back verbatim on the next turn. Google's
   * OpenAI-compatible endpoint carries its required `thought_signature` here
   * (`{ google: { thought_signature } }`); absent for other providers. The agent
   * loop must feed this object back unchanged on the assistant turn, so don't
   * rebuild ToolCall objects field-by-field and drop it. */
  extra_content?: unknown;
}

/** One turn in the agent conversation. */
export interface AgentChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  /** Present on an assistant turn that requested tool calls. */
  tool_calls?: ToolCall[];
  /** Present on a tool-result message (role === "tool"). */
  tool_call_id?: string;
  /** Tool name, on a tool-result message. */
  name?: string;
}

/** A function/tool schema offered to the model. */
export interface ToolSchema {
  name: string;
  description?: string;
  /** JSON Schema for the tool's parameters (object schema). */
  parameters: Record<string, unknown>;
}

/** One model turn parsed back into provider-neutral form. */
export interface AgentTurn {
  content: string | null;
  tool_calls: ToolCall[];
  finish_reason?: string | null;
}

// ─── API Client Service Layer ────────────────────────────────
export const api = {
  // Workspaces Management
  async getWorkspaces(): Promise<Workspace[]> {
    return invoke<Workspace[]>("get_workspaces");
  },

  async addWorkspace(path: string): Promise<Workspace> {
    return invoke<Workspace>("add_workspace", { path });
  },

  async removeWorkspace(path: string): Promise<void> {
    return invoke<void>("remove_workspace", { path });
  },

  async setWorkspaceBackgroundExecution(path: string, enabled: boolean): Promise<void> {
    return invoke<void>("set_workspace_background_execution", { path, enabled });
  },

  // Batched per-workspace status rollup for the Dashboard's colored dot.
  // Reads `.hive/config.json` per path; never loads space contents.
  async getWorkspaceStatusRollups(paths: string[]): Promise<WorkspaceStatusRollup[]> {
    return invoke<WorkspaceStatusRollup[]>("get_workspace_status_rollups", { paths });
  },

  // Space Configurations
  async loadWorkspaceConfig(workspacePath: string): Promise<WorkspaceConfig> {
    return invoke<WorkspaceConfig>("load_workspace_config", { workspacePath });
  },

  async saveWorkspaceConfig(workspacePath: string, config: WorkspaceConfig): Promise<void> {
    return invoke<void>("save_workspace_config", { workspacePath, config });
  },

  // Space Management
  async loadSpace(workspacePath: string, spaceId: string): Promise<SpaceData> {
    return invoke<SpaceData>("load_space", { workspacePath, spaceId });
  },

  async saveSpace(workspacePath: string, spaceData: SpaceData): Promise<void> {
    return invoke<void>("save_space", { workspacePath, space: spaceData });
  },

  async createSpace(workspacePath: string, spaceId: string, label: string): Promise<void> {
    return invoke<void>("create_space", { workspacePath, spaceId, label });
  },

  async deleteSpace(workspacePath: string, spaceId: string): Promise<void> {
    return invoke<void>("delete_space", { workspacePath, spaceId });
  },

  // Database / JSON Storage
  async deleteStorageHistory(workspacePath: string, spaceId: string, databaseNodeId: string): Promise<void> {
    return invoke<void>("delete_storage_history", { workspacePath, spaceId, databaseNodeId });
  },

  // Chat history (persisted per chat node under .hive/chats/<spaceId>/<nodeId>.json)
  async deleteChatHistory(workspacePath: string, spaceId: string, chatNodeId: string): Promise<void> {
    return invoke<void>("delete_chat_history", { workspacePath, spaceId, chatNodeId });
  },

  // OS Notification Action
  async sendNotification(title: string, body: string): Promise<void> {
    return invoke<void>("send_notification", { title, body });
  },

  // Node defaults (global + workspace)
  async loadGlobalNodeDefaults(): Promise<NodeDefaultsConfig> {
    return invoke<NodeDefaultsConfig>("load_global_node_defaults");
  },

  async saveGlobalNodeDefaults(config: NodeDefaultsConfig): Promise<void> {
    return invoke<void>("save_global_node_defaults", { config });
  },

  async loadWorkspaceNodeDefaults(workspacePath: string): Promise<NodeDefaultsConfig> {
    return invoke<NodeDefaultsConfig>("load_workspace_node_defaults", { workspacePath });
  },

  async saveWorkspaceNodeDefaults(workspacePath: string, config: NodeDefaultsConfig): Promise<void> {
    return invoke<void>("save_workspace_node_defaults", { workspacePath, config });
  },

  // Tools registry (global + workspace)
  async loadGlobalTools(): Promise<ToolsConfig> {
    return invoke<ToolsConfig>("load_global_tools");
  },

  async saveGlobalTools(config: ToolsConfig): Promise<void> {
    return invoke<void>("save_global_tools", { config });
  },

  async loadWorkspaceTools(workspacePath: string): Promise<ToolsConfig> {
    return invoke<ToolsConfig>("load_workspace_tools", { workspacePath });
  },

  async saveWorkspaceTools(workspacePath: string, config: ToolsConfig): Promise<void> {
    return invoke<void>("save_workspace_tools", { workspacePath, config });
  },

  // Skills. Metadata lives in tools.json `skills[]`; the SKILL.md instruction body
  // lives at <scope>/skills/<id>/SKILL.md. `loadSkillContent` is local-first (used by
  // the agent's load_skill tool); save/open take an explicit scope.
  async loadSkillContent(workspacePath: string | null, id: string): Promise<string> {
    return invoke<string>("load_skill_content", { workspacePath: workspacePath ?? null, id });
  },

  async saveSkillContent(
    scope: "global" | "workspace",
    id: string,
    content: string,
    workspacePath: string | null
  ): Promise<void> {
    return invoke<void>("save_skill_content", {
      scope,
      id,
      content,
      workspacePath: workspacePath ?? null,
    });
  },

  async openSkillInstructions(
    scope: "global" | "workspace",
    id: string,
    workspacePath: string | null
  ): Promise<void> {
    return invoke<void>("open_skill_instructions", {
      scope,
      id,
      workspacePath: workspacePath ?? null,
    });
  },

  // Custom nodes (global + workspace)
  async listGlobalCustomNodes(): Promise<CustomNodeDefinition[]> {
    return invoke<CustomNodeDefinition[]>("list_global_custom_nodes");
  },

  async listWorkspaceCustomNodes(workspacePath: string): Promise<CustomNodeDefinition[]> {
    return invoke<CustomNodeDefinition[]>("list_workspace_custom_nodes", { workspacePath });
  },

  async saveGlobalCustomNode(def: CustomNodeDefinition): Promise<void> {
    return invoke<void>("save_global_custom_node", { def });
  },

  async saveWorkspaceCustomNode(workspacePath: string, def: CustomNodeDefinition): Promise<void> {
    return invoke<void>("save_workspace_custom_node", { workspacePath, def });
  },

  async deleteGlobalCustomNode(id: string): Promise<void> {
    return invoke<void>("delete_global_custom_node", { id });
  },

  async deleteWorkspaceCustomNode(workspacePath: string, id: string): Promise<void> {
    return invoke<void>("delete_workspace_custom_node", { workspacePath, id });
  },

  async customNodeTransfer(
    id: string,
    fromScope: "global" | "workspace",
    toScope: "global" | "workspace",
    workspacePath?: string | null
  ): Promise<CustomNodeDefinition> {
    return invoke<CustomNodeDefinition>("custom_node_transfer", {
      id,
      fromScope,
      toScope,
      workspacePath: workspacePath ?? null,
    });
  },

  // Tier-3 script nodes. Source + grants are read off disk by Rust; the renderer
  // only supplies per-instance input + config. The plaintext of any granted
  // credential is injected server-side and never crosses back into the renderer.
  async runScript(args: {
    scope: CustomNodeScope;
    id: string;
    workspacePath: string | null;
    input: NodeOutputEnvelope;
    config: Record<string, unknown>;
  }): Promise<ScriptRunResult> {
    return invoke<ScriptRunResult>("run_script", {
      scope: args.scope,
      id: args.id,
      workspacePath: args.workspacePath ?? null,
      input: args.input,
      config: args.config,
    });
  },

  // Ensure the node's script.js exists (writing a starter template if absent),
  // then open it with the OS default editor via tauri-plugin-opener.
  async openCustomNodeScript(
    scope: CustomNodeScope,
    id: string,
    workspacePath: string | null
  ): Promise<void> {
    return invoke<void>("open_custom_node_script", {
      scope,
      id,
      workspacePath: workspacePath ?? null,
    });
  },

  // Polymorphic Generic LLM Inference.
  // Pass `credentialId` (and optionally `credentialScope` + `workspacePath`) to have
  // Rust resolve the secret from the vault server-side. The plaintext key never
  // crosses back into the renderer.
  async llmChat(
    provider: string,
    baseURL: string,
    modelName: string,
    messages: ChatMessage[],
    temperature: number,
    maxTokens: number,
    credentialId?: string | null,
    credentialScope?: "global" | "local" | null,
    workspacePath?: string | null
  ): Promise<string> {
    return invoke<string>("llm_chat", {
      provider,
      baseURL,
      credentialId: credentialId ?? null,
      credentialScope: credentialScope ?? null,
      workspacePath: workspacePath ?? null,
      modelName,
      messages,
      temperature,
      maxTokens,
    });
  },

  // Tool-calling inference. Same credential resolution as `llmChat`, but passes
  // function schemas and a richer message shape and returns any tool-call requests
  // the model made (provider-neutral). The renderer-side agent loop executes the
  // tools and calls this again with the results appended.
  async llmChatTools(
    provider: string,
    baseURL: string,
    modelName: string,
    messages: AgentChatMessage[],
    temperature: number,
    maxTokens: number,
    tools: ToolSchema[],
    credentialId?: string | null,
    credentialScope?: "global" | "local" | null,
    workspacePath?: string | null
  ): Promise<AgentTurn> {
    return invoke<AgentTurn>("llm_chat_tools", {
      provider,
      baseURL,
      credentialId: credentialId ?? null,
      credentialScope: credentialScope ?? null,
      workspacePath: workspacePath ?? null,
      modelName,
      messages,
      temperature,
      maxTokens,
      tools,
    });
  },

  // MCP (Model Context Protocol). The server connection config lives on disk in
  // the tools.json `mcp[]` entry; Rust reads it by id (local-first) and
  // spawns/connects server-side — the renderer only passes the server id + tool
  // name + the model's arguments. `mcpListTools` discovers a server's tools;
  // `mcpCallTool` invokes one and returns its text result.
  async mcpListTools(workspacePath: string | null, id: string): Promise<ToolSchema[]> {
    return invoke<ToolSchema[]>("mcp_list_tools", {
      workspacePath: workspacePath ?? null,
      id,
    });
  },

  async mcpCallTool(
    workspacePath: string | null,
    id: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    return invoke<string>("mcp_call_tool", {
      workspacePath: workspacePath ?? null,
      id,
      toolName,
      arguments: args,
    });
  },

  // Execute a built-in native Agent tool server-side, returning its textual result.
  // For web_search, pass the bound credentialId; Rust resolves it from the vault and
  // the plaintext key never crosses back into the renderer.
  async runNativeTool(
    toolId: string,
    args: Record<string, unknown>,
    workspacePath?: string | null,
    credentialId?: string | null,
    credentialScope?: "global" | "local" | null
  ): Promise<string> {
    return invoke<string>("run_native_tool", {
      toolId,
      arguments: args,
      workspacePath: workspacePath ?? null,
      credentialId: credentialId ?? null,
      credentialScope: credentialScope ?? null,
    });
  },

  // Execute a user-defined HTTP tool server-side. The url/method/headers/body and
  // (granted) credential live on disk in the tool's `http` config, read by id; the
  // renderer passes only the tool id + the model's arguments.
  async runHttpTool(
    workspacePath: string | null,
    id: string,
    args: Record<string, unknown>
  ): Promise<string> {
    return invoke<string>("run_http_tool", {
      workspacePath: workspacePath ?? null,
      id,
      arguments: args,
    });
  },

  // Execute a user-defined script tool in the QuickJS sandbox. The JS body + grants
  // live on disk; the model's arguments arrive as ctx.config (and ctx.input.data).
  async runToolScript(
    workspacePath: string | null,
    id: string,
    args: Record<string, unknown>
  ): Promise<{ output: string; logs: string[] }> {
    return invoke<{ output: string; logs: string[] }>("run_tool_script", {
      workspacePath: workspacePath ?? null,
      id,
      arguments: args,
    });
  },

  // Ensure a script tool's script.js exists (seeding a starter if absent) and reveal
  // it in the OS file manager so the user can author it in their own editor.
  async openToolScript(
    scope: "global" | "workspace",
    id: string,
    workspacePath: string | null
  ): Promise<void> {
    return invoke<void>("open_tool_script", {
      scope,
      id,
      workspacePath: workspacePath ?? null,
    });
  },

  // Credential vault. Secrets are encrypted at rest and resolved server-side;
  // `credentialResolve` returns plaintext and is for the Settings editor only —
  // executors must pass a credentialId to `llmChat`/`runScript` instead.
  async credentialList(workspacePath?: string | null): Promise<CredentialMeta[]> {
    return invoke<CredentialMeta[]>("credential_list", {
      workspacePath: workspacePath ?? null,
    });
  },

  async credentialAdd(
    scope: CredentialScope,
    name: string,
    schemaType: string,
    provider: string,
    values: CredentialValues,
    workspacePath?: string | null
  ): Promise<CredentialMeta> {
    return invoke<CredentialMeta>("credential_add", {
      scope,
      workspacePath: workspacePath ?? null,
      name,
      schemaType,
      provider,
      values,
    });
  },

  async credentialUpdate(
    scope: CredentialScope,
    id: string,
    name: string | null,
    values: CredentialValues | null,
    workspacePath?: string | null
  ): Promise<CredentialMeta> {
    return invoke<CredentialMeta>("credential_update", {
      scope,
      workspacePath: workspacePath ?? null,
      id,
      name,
      values,
    });
  },

  async credentialRemove(
    scope: CredentialScope,
    id: string,
    workspacePath?: string | null
  ): Promise<void> {
    return invoke<void>("credential_remove", {
      scope,
      workspacePath: workspacePath ?? null,
      id,
    });
  },

  async credentialTransfer(
    id: string,
    fromScope: CredentialScope,
    toScope: CredentialScope,
    workspacePath?: string | null
  ): Promise<CredentialMeta> {
    return invoke<CredentialMeta>("credential_transfer", {
      id,
      fromScope,
      toScope,
      workspacePath: workspacePath ?? null,
    });
  },

  async credentialResolve(
    id: string,
    scope?: CredentialScope | null,
    workspacePath?: string | null
  ): Promise<CredentialValues> {
    return invoke<CredentialValues>("credential_resolve", {
      id,
      scope: scope ?? null,
      workspacePath: workspacePath ?? null,
    });
  },
};
