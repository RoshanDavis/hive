import { useState, type Dispatch, type SetStateAction } from "react";
import { api } from "@/services/api";
import type { HandleConfig, NodePlugin } from "@/engine/plugin";
import type {
  CustomNodeDefinition,
  CustomNodeScope,
  NetworkGrant,
  ScriptField,
  ScriptLimits,
} from "@/types/customNodes";

const DEFAULT_SCRIPT_LIMITS: ScriptLimits = {
  timeoutMs: 5000,
  memoryBytes: 16 * 1024 * 1024,
};

interface UseScriptFormStateArgs {
  initialLimits?: ScriptLimits;
  initialNetwork?: NetworkGrant;
  initialCredentials?: string[];
  initialConfigSchema?: ScriptField[];
  initialHandles?: HandleConfig[];
  /** Preserved verbatim across edit cycles; not edited in the UI. */
  scriptRuntime: "js" | "wasm";
  scriptEntry: string;
}

export interface ScriptFormState {
  limits: ScriptLimits;
  setLimits: Dispatch<SetStateAction<ScriptLimits>>;
  network: NetworkGrant;
  setNetwork: Dispatch<SetStateAction<NetworkGrant>>;
  credentials: string[];
  setCredentials: Dispatch<SetStateAction<string[]>>;
  configSchema: ScriptField[];
  setConfigSchema: Dispatch<SetStateAction<ScriptField[]>>;
  handles: HandleConfig[];
  setHandles: Dispatch<SetStateAction<HandleConfig[]>>;
  opening: boolean;
  openScriptInEditor(opts: {
    id: string;
    scope: CustomNodeScope;
    workspacePath: string | null;
    showToast: (msg: string, kind: "success" | "error" | "info") => void;
  }): Promise<void>;
  validate(): string | null;
  buildDef(args: {
    id: string;
    name: string;
    icon: string;
    category: NodePlugin["meta"]["category"];
  }): CustomNodeDefinition;
  /** Run after the script def has been persisted on a fresh create — seeds
   * `script.js` on disk and reveals it in the OS file manager. Best-effort;
   * a failure is non-fatal (the inspector's "Open" button is the backup). */
  seedAndReveal(opts: {
    id: string;
    scope: CustomNodeScope;
    workspacePath: string | null;
  }): Promise<void>;
}

/**
 * Validate a script's authoring fields. Config keys must be non-empty and
 * unique (they key into `ctx.config`); handle ids must be non-empty and
 * unique once there's more than one handle, or React Flow can't disambiguate
 * which handle an edge connects to.
 */
function validateScriptDef(
  configSchema: ScriptField[],
  handles: HandleConfig[]
): string | null {
  const keys = configSchema.map((f) => f.key.trim());
  if (keys.some((k) => k === "")) return "Every config field needs a non-empty key.";
  const dupKey = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dupKey) return `Duplicate config field key: "${dupKey}".`;

  if (handles.length > 1) {
    const ids = handles.map((h) => (h.id ?? "").trim());
    if (ids.some((id) => id === ""))
      return "With more than one handle, every handle needs a non-empty id.";
    const dupId = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dupId) return `Duplicate handle id: "${dupId}".`;
  }
  return null;
}

/**
 * Owns the state + save shape for the "script" branch of `CustomNodeFormModal`.
 * Side effects (revealing script.js in the OS file manager) are exposed as
 * methods on the returned hook so the modal can sequence them cleanly.
 */
export function useScriptFormState({
  initialLimits,
  initialNetwork,
  initialCredentials,
  initialConfigSchema,
  initialHandles,
  scriptRuntime,
  scriptEntry,
}: UseScriptFormStateArgs): ScriptFormState {
  const [limits, setLimits] = useState<ScriptLimits>(initialLimits ?? DEFAULT_SCRIPT_LIMITS);
  const [network, setNetwork] = useState<NetworkGrant>(
    initialNetwork ?? { mode: "none", allow: [] }
  );
  const [credentials, setCredentials] = useState<string[]>(initialCredentials ?? []);
  const [configSchema, setConfigSchema] = useState<ScriptField[]>(initialConfigSchema ?? []);
  const [handles, setHandles] = useState<HandleConfig[]>(initialHandles ?? []);
  const [opening, setOpening] = useState(false);

  const openScriptInEditor: ScriptFormState["openScriptInEditor"] = async ({
    id,
    scope,
    workspacePath,
    showToast,
  }) => {
    setOpening(true);
    try {
      await api.openCustomNodeScript(scope, id, scope === "workspace" ? workspacePath : null);
    } catch (err) {
      showToast(`Failed to open script: ${err}`, "error");
    } finally {
      setOpening(false);
    }
  };

  const validate = (): string | null => validateScriptDef(configSchema, handles);

  const buildDef: ScriptFormState["buildDef"] = ({ id, name, icon, category }) => {
    // Persist trimmed keys/ids (validated above) so on-disk config keys and
    // handle ids never carry stray whitespace. A lone handle may keep an
    // empty (undefined) id.
    const normConfig = configSchema.map((f) => ({
      ...f,
      key: f.key.trim(),
      label: f.label.trim(),
    }));
    const normHandles = handles.map((h) => ({
      ...h,
      id: (h.id ?? "").trim() || undefined,
    }));
    return {
      id,
      kind: "script",
      name: name.trim(),
      icon: icon.trim() || "📜",
      category,
      version: 1,
      runtime: scriptRuntime,
      entry: scriptEntry,
      configSchema: normConfig,
      network,
      credentials,
      limits,
      ...(normHandles.length > 0 ? { handles: normHandles } : {}),
    };
  };

  const seedAndReveal: ScriptFormState["seedAndReveal"] = async ({ id, scope, workspacePath }) => {
    try {
      await api.openCustomNodeScript(scope, id, scope === "workspace" ? workspacePath : null);
    } catch {
      /* non-fatal: the node is saved; the inspector offers "Open" too */
    }
  };

  return {
    limits,
    setLimits,
    network,
    setNetwork,
    credentials,
    setCredentials,
    configSchema,
    setConfigSchema,
    handles,
    setHandles,
    opening,
    openScriptInEditor,
    validate,
    buildDef,
    seedAndReveal,
  };
}
