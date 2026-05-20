import type { NodeExecutor } from "./types";
import { NotifyExecutor } from "./NotifyExecutor";
import { OllamaExecutor } from "./OllamaExecutor";
import { ChatExecutor, type ChatExecutionContext } from "./ChatExecutor";

export * from "./types";
export * from "./ChatExecutor";

const executors: Record<string, NodeExecutor> = {
  notify: new NotifyExecutor(),
  ollama: new OllamaExecutor(),
  chat: new ChatExecutor(),
};

export const executeNode = async (
  nodeType: string,
  context: ChatExecutionContext
): Promise<void> => {
  const executor = executors[nodeType];
  if (executor) {
    await executor.execute(context);
  } else {
    // Passive nodes or nodes without executors (trigger, chat, output, etc.)
    if (!["trigger", "chat", "output"].includes(nodeType)) {
      console.warn(`No executor found for node type: ${nodeType}`);
    }
  }
};
