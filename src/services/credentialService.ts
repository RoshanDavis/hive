import { api } from "./api";
import type {
  CredentialMeta,
  CredentialScope,
  CredentialValues,
} from "@/types/credentialTypes";

export const credentialService = {
  async list(workspacePath?: string): Promise<CredentialMeta[]> {
    return api.credentialList(workspacePath ?? null);
  },

  async add(
    scope: CredentialScope,
    name: string,
    schemaType: string,
    provider: string,
    values: CredentialValues,
    workspacePath?: string
  ): Promise<CredentialMeta> {
    return api.credentialAdd(scope, name, schemaType, provider, values, workspacePath ?? null);
  },

  async update(
    scope: CredentialScope,
    id: string,
    name: string | null,
    values: CredentialValues | null,
    workspacePath?: string
  ): Promise<CredentialMeta> {
    return api.credentialUpdate(scope, id, name, values, workspacePath ?? null);
  },

  async remove(
    scope: CredentialScope,
    id: string,
    workspacePath?: string
  ): Promise<void> {
    return api.credentialRemove(scope, id, workspacePath ?? null);
  },

  async transfer(
    id: string,
    fromScope: CredentialScope,
    toScope: CredentialScope,
    workspacePath?: string
  ): Promise<CredentialMeta> {
    return api.credentialTransfer(id, fromScope, toScope, workspacePath ?? null);
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
    return api.credentialResolve(id, scope ?? null, workspacePath ?? null);
  },
};
