import { api } from "@/services/api";
import type { CustomNodeScope, ScriptField } from "@/types/customNodes";
import type { ExecutionContext, NodeExecutor, NodeOutputEnvelope } from "./types";
import { getUpstreamNodeEnvelope } from "./utils";

/**
 * The single shared adapter for every Tier-3 script node. `synthesizePlugin`
 * constructs one instance per script definition, capturing the node's id +
 * scope + config field keys. Execution itself runs in the Rust `run_script`
 * sandbox — this class only resolves the input envelope, collects the instance
 * config, hands them to Rust, and writes the result back through the standard
 * envelope contract.
 */
export class ScriptExecutor implements NodeExecutor {
  constructor(
    private readonly id: string,
    private readonly scope: CustomNodeScope,
    private readonly configSchema: ScriptField[]
  ) {}

  async execute(context: ExecutionContext): Promise<void> {
    const { node, nodes, edges, updateNodeData, showToast, visited, workspacePath } = context;

    // Resolve the input envelope from the first visited upstream node (storage
    // edges excluded), mirroring the engine's passive-node resolution.
    const incoming = edges.filter(
      (e) =>
        e.target === node.id &&
        e.sourceHandle !== "storage" &&
        e.targetHandle !== "storage"
    );
    let input: NodeOutputEnvelope = { value: "" };
    for (const edge of incoming) {
      const upstream = nodes.find((n) => n.id === edge.source);
      if (!upstream) continue;
      if (visited && !visited.has(upstream.id)) continue;
      input = getUpstreamNodeEnvelope(upstream);
      break;
    }

    // Collect only the declared config fields from node.data, falling back to defaults.
    const config: Record<string, unknown> = {};
    for (const field of this.configSchema) {
      const v = node.data?.[field.key];
      config[field.key] = v !== undefined ? v : field.default;
    }

    try {
      const result = await api.runScript({
        scope: this.scope,
        id: this.id,
        workspacePath,
        input,
        config,
      });

      updateNodeData(node.id, {
        ...node.data,
        lastResponse: result.output.value,
        outputEnvelope: result.output,
        logs: result.logs,
      });
    } catch (err) {
      showToast(`Script execution error: ${err}`, "error");
      throw err;
    }
  }
}
