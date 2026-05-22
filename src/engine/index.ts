import type { NodeExecutor } from "./types";
import { NotifyExecutor } from "./NotifyExecutor";
import { OllamaExecutor } from "./OllamaExecutor";
import { ChatExecutor, type ChatExecutionContext } from "./ChatExecutor";
import { OutputExecutor } from "./OutputExecutor";

export * from "./types";
export * from "./ChatExecutor";

const executors: Record<string, NodeExecutor> = {
  notify: new NotifyExecutor(),
  ollama: new OllamaExecutor(),
  chat: new ChatExecutor(),
  output: new OutputExecutor(),
  outputNode: new OutputExecutor(),
};

export const executeNode = async (
  nodeType: string,
  context: ChatExecutionContext
): Promise<void> => {
  const executor = executors[nodeType];
  if (executor) {
    await executor.execute(context);
  } else {
    // Passive nodes or nodes without executors (trigger, chat, etc.)
    if (!["trigger", "chat"].includes(nodeType)) {
      console.warn(`No executor found for node type: ${nodeType}`);
    }
  }
};
