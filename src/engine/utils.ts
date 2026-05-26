import type { Node } from "@xyflow/react";
import type { NodeOutputEnvelope } from "./types";
import { pluginRegistry } from "./pluginRegistry";

/**
 * Extracts data from an upstream node based on standard data fields
 * supporting sequential information transmission through the workflow.
 * 
 * Uses plugin.getOutput() if available, otherwise falls back to
 * reading from the standardized outputEnvelope, then common data fields.
 */
export function getUpstreamNodeData(upstreamNode: Node): string | null {
  if (!upstreamNode || !upstreamNode.data) return null;

  // 1. Try plugin-specific output extraction
  const plugin = pluginRegistry.get(upstreamNode.type || "");
  if (plugin?.getOutput) {
    const envelope = plugin.getOutput(upstreamNode.data as Record<string, unknown>);
    if (envelope.value) return envelope.value;
  }

  // 2. Read from standardized outputEnvelope
  if (upstreamNode.data.outputEnvelope) {
    const env = upstreamNode.data.outputEnvelope as NodeOutputEnvelope;
    if (env.value) return env.value;
  }

  // 3. Fallback chain for backward compatibility with nodes
  //    that haven't written an outputEnvelope yet
  if (upstreamNode.data.lastResponse !== undefined && upstreamNode.data.lastResponse !== null) {
    return String(upstreamNode.data.lastResponse);
  }

  if (upstreamNode.data.outputContent !== undefined && upstreamNode.data.outputContent !== null) {
    return String(upstreamNode.data.outputContent);
  }

  if (upstreamNode.data.output !== undefined && upstreamNode.data.output !== null) {
    return String(upstreamNode.data.output);
  }

  if (upstreamNode.data.value !== undefined && upstreamNode.data.value !== null) {
    return String(upstreamNode.data.value);
  }

  return null;
}

/**
 * Extracts the full standard JSON data envelope from an upstream node,
 * automatically packaging primitive string outputs in a standard envelope structure if necessary.
 */
export function getUpstreamNodeEnvelope(upstreamNode: Node): NodeOutputEnvelope {
  if (!upstreamNode || !upstreamNode.data) {
    return { value: "" };
  }

  // 1. Try plugin-specific output extraction
  const plugin = pluginRegistry.get(upstreamNode.type || "");
  if (plugin?.getOutput) {
    return plugin.getOutput(upstreamNode.data as Record<string, unknown>);
  }

  // 2. If the node has a structured outputEnvelope, load and return it directly
  if (upstreamNode.data.outputEnvelope !== undefined && upstreamNode.data.outputEnvelope !== null) {
    return upstreamNode.data.outputEnvelope as NodeOutputEnvelope;
  }

  // 3. Fallback: package the raw string output value inside a standard default envelope
  const rawText = getUpstreamNodeData(upstreamNode) || "";
  return {
    value: rawText,
    metadata: { generatedFallback: true, timestamp: new Date().toISOString() },
    data: rawText
  };
}
