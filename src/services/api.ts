import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceConfig, SpaceData } from "@/types/workspace";

// ─── Tauri Return Models ─────────────────────────────────────
export interface Workspace {
  name: string;
  path: string;
  is_initialized: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  sender?: string;
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

  // OS Notification Action
  async sendNotification(title: string, body: string): Promise<void> {
    return invoke<void>("send_notification", { title, body });
  },

  // Ollama Inference
  async ollamaChat(
    ollamaUrl: string,
    model: string,
    messages: ChatMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<string> {
    return invoke<string>("ollama_chat", {
      ollamaUrl,
      model,
      messages,
      temperature,
      maxTokens,
    });
  },

  // Polymorphic Generic LLM Inference.
  // Pass `credentialId` (and optionally `credentialScope` + `workspacePath`) to have
  // Rust resolve the secret from the vault server-side. The plaintext key never
  // crosses back into the renderer. The legacy `apiKey` parameter is honored only
  // when no credentialId is provided.
  async llmChat(
    provider: string,
    baseURL: string,
    apiKey: string,
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
      apiKey,
      credentialId: credentialId ?? null,
      credentialScope: credentialScope ?? null,
      workspacePath: workspacePath ?? null,
      modelName,
      messages,
      temperature,
      maxTokens,
    });
  },
};
