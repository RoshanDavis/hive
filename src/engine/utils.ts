import type { Node } from "@xyflow/react";
import type { NodeOutputEnvelope } from "./types";

/**
 * Extracts data from an upstream node based on standard data fields
 * supporting sequential information transmission through the workflow.
 */
export function getUpstreamNodeData(upstreamNode: Node): string | null {
  if (!upstreamNode || !upstreamNode.data) return null;

  // 0. If it's a Chat node, prioritize the last USER message as its outward payload
  if (upstreamNode.type === "chat") {
    if (Array.isArray(upstreamNode.data.messages) && upstreamNode.data.messages.length > 0) {
      const lastUserMsg = [...upstreamNode.data.messages]
        .reverse()
        .find((m: any) => m.role === "user");
      if (lastUserMsg && lastUserMsg.content !== undefined && lastUserMsg.content !== null) {
        return String(lastUserMsg.content);
      }
    }
  }

  // 1. Check lastResponse (commonly used by Ollama, Notify, Output)
  if (upstreamNode.data.lastResponse !== undefined && upstreamNode.data.lastResponse !== null) {
    return String(upstreamNode.data.lastResponse);
  }

  // 2. Check outputContent (commonly used by Output)
  if (upstreamNode.data.outputContent !== undefined && upstreamNode.data.outputContent !== null) {
    return String(upstreamNode.data.outputContent);
  }

  // 3. Check messages (commonly used by Chat)
  if (Array.isArray(upstreamNode.data.messages) && upstreamNode.data.messages.length > 0) {
    const lastMsg = upstreamNode.data.messages[upstreamNode.data.messages.length - 1];
    if (lastMsg && lastMsg.content !== undefined && lastMsg.content !== null) {
      return String(lastMsg.content);
    }
  }

  // 4. Check output (commonly used by Notify)
  if (upstreamNode.data.output !== undefined && upstreamNode.data.output !== null) {
    return String(upstreamNode.data.output);
  }

  // 5. Check message (commonly used by Notify fallback)
  if (upstreamNode.data.message !== undefined && upstreamNode.data.message !== null) {
    return String(upstreamNode.data.message);
  }

  // 5. Check value
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

  // 1. If the node has a structured outputEnvelope, load and return it directly
  if (upstreamNode.data.outputEnvelope !== undefined && upstreamNode.data.outputEnvelope !== null) {
    return upstreamNode.data.outputEnvelope as NodeOutputEnvelope;
  }

  // 2. Fallback: package the raw string output value inside a standard default envelope
  const rawText = getUpstreamNodeData(upstreamNode) || "";
  return {
    value: rawText,
    metadata: { generatedFallback: true, timestamp: new Date().toISOString() },
    data: rawText
  };
}
