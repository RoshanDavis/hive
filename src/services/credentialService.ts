import { invoke } from "@tauri-apps/api/core";
import type {
  CredentialMeta,
  CredentialScope,
  CredentialValues,
} from "@/types/credentialTypes";

export const credentialService = {
  async list(workspacePath?: string): Promise<CredentialMeta[]> {
    return invoke<CredentialMeta[]>("credential_list", {
      workspacePath: workspacePath ?? null,
    });
  },

  async add(
    scope: CredentialScope,
    name: string,
    schemaType: string,
    provider: string,
    values: CredentialValues,
    workspacePath?: string
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

  async update(
    scope: CredentialScope,
    id: string,
    name: string | null,
    values: CredentialValues | null,
    workspacePath?: string
  ): Promise<CredentialMeta> {
    return invoke<CredentialMeta>("credential_update", {
      scope,
      workspacePath: workspacePath ?? null,
      id,
      name,
      values,
    });
  },

  async remove(
    scope: CredentialScope,
    id: string,
    workspacePath?: string
  ): Promise<void> {
    return invoke<void>("credential_remove", {
      scope,
      workspacePath: workspacePath ?? null,
      id,
    });
  },

  async transfer(
    id: string,
    fromScope: CredentialScope,
    toScope: CredentialScope,
    workspacePath?: string
  ): Promise<CredentialMeta> {
    return invoke<CredentialMeta>("credential_transfer", {
      id,
      fromScope,
      toScope,
      workspacePath: workspacePath ?? null,
    });
  },

  // Plaintext-returning resolve. Only used by Settings UI when the user is
  // editing a credential and wants to see/update the existing values.
  // Executors must NOT call this — they pass credentialId to llm_chat and
  // Rust resolves internally.
  async resolve(
    id: string,
    scope?: CredentialScope,
    workspacePath?: string
  ): Promise<CredentialValues> {
    return invoke<CredentialValues>("credential_resolve", {
      id,
      scope: scope ?? null,
      workspacePath: workspacePath ?? null,
    });
  },
};
