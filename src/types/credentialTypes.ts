// Plugin-declared credential schema. Each schema describes one credential
// shape (e.g. an OpenAI API key, a Google OAuth token bundle). Plugins
// publish their schemas via NodePlugin.credentialSchemas and the UI
// auto-generates forms from them.

export type CredentialScope = "global" | "local";

export interface CredentialField {
  key: string;
  label: string;
  type: "password" | "text" | "url";
  required: boolean;
  placeholder?: string;
}

export interface CredentialSchema {
  type: string;
  label: string;
  provider: string;
  icon?: string;
  fields: CredentialField[];
}

// Metadata returned by the Rust backend's credential_list / credential_add.
// Never contains decrypted values.
export interface CredentialMeta {
  id: string;
  name: string;
  schemaType: string;
  provider: string;
  scope: CredentialScope;
  createdAt: string;
  updatedAt: string;
}

export type CredentialValues = Record<string, string>;
