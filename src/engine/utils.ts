import type { Node } from "@xyflow/react";
import type { NodeOutputEnvelope } from "./types";
import { pluginRegistry } from "./pluginRegistry";

/**
 * Extracts the string `value` from an upstream node, going through
 * `plugin.getOutput()` if defined and otherwise falling back to the
 * standardized `outputEnvelope` written by executors.
 */
export function getUpstreamNodeData(upstreamNode: Node): string | null {
  if (!upstreamNode || !upstreamNode.data) return null;

  const plugin = pluginRegistry.get(upstreamNode.type || "");
  if (plugin?.getOutput) {
    const envelope = plugin.getOutput(upstreamNode.data as Record<string, unknown>);
    if (envelope.value !== undefined && envelope.value !== null) return envelope.value;
  }

  const envelope = upstreamNode.data.outputEnvelope as NodeOutputEnvelope | undefined;
  if (envelope && envelope.value !== undefined && envelope.value !== null) {
    return envelope.value;
  }

  return null;
}

/**
 * Returns the full standard JSON envelope from an upstream node. If the node
 * has not yet produced one, returns an empty envelope rather than synthesizing.
 */
export function getUpstreamNodeEnvelope(upstreamNode: Node): NodeOutputEnvelope {
  if (!upstreamNode || !upstreamNode.data) {
    return { value: "" };
  }

  const plugin = pluginRegistry.get(upstreamNode.type || "");
  if (plugin?.getOutput) {
    return plugin.getOutput(upstreamNode.data as Record<string, unknown>);
  }

  const envelope = upstreamNode.data.outputEnvelope as NodeOutputEnvelope | undefined;
  if (envelope) return envelope;

  return { value: "" };
}
