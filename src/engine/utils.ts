import type { Node } from "@xyflow/react";

/**
 * Extracts data from an upstream node based on standard data fields
 * supporting sequential information transmission through the workflow.
 */
export function getUpstreamNodeData(upstreamNode: Node): string | null {
  if (!upstreamNode || !upstreamNode.data) return null;

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
