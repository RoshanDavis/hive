import type { ExecutionContext, NodeExecutor } from "./types";
import { setOutputEnvelope } from "./nodeData";
import { callLlm, llmRequiresCredential, resolveLlmConfig, resolveLlmInputMessages } from "./llmInference";

export class LLMExecutor implements NodeExecutor {
  async execute(context: ExecutionContext): Promise<void> {
    const { node, updateNodeData, showToast, workspacePath } = context;

    const config = resolveLlmConfig(node.data);

    // Fail early with an actionable message instead of a generic 401.
    if (llmRequiresCredential(config.provider) && !config.credentialId) {
      throw new Error(
        `No credential selected for ${config.provider}. Open the LLM inspector and pick or add one.`
      );
    }

    const messages = resolveLlmInputMessages(context, config.chatHistoryLimit);

    try {
      const envelope = await callLlm(config, messages, workspacePath);
      updateNodeData(node.id, setOutputEnvelope(node.data, envelope));
    } catch (err) {
      showToast(`LLM execution error: ${err}`, "error");
      throw err;
    }
  }
}
