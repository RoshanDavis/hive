import type { NodeExecutor } from "./types";
import { NotifyExecutor } from "./NotifyExecutor";
import { OllamaExecutor } from "./OllamaExecutor";
import { ChatExecutor } from "./ChatExecutor";
import { OutputExecutor } from "./OutputExecutor";

class ExecutorRegistry {
  private executors = new Map<string, NodeExecutor>();

  constructor() {
    // Automatically register all default/core engine executors
    this.register("notify", new NotifyExecutor());
    this.register("ollama", new OllamaExecutor());
    this.register("chat", new ChatExecutor());
    this.register("output", new OutputExecutor());
    this.register("outputNode", new OutputExecutor());
  }

  /**
   * Registers a new executor for a given node type.
   * This enables custom plugin engines or new node packs to register themselves.
   */
  register(nodeType: string, executor: NodeExecutor): void {
    this.executors.set(nodeType, executor);
  }

  /**
   * Retrieves the executor registered for a given node type.
   */
  get(nodeType: string): NodeExecutor | undefined {
    return this.executors.get(nodeType);
  }

  /**
   * Unregisters an executor.
   */
  unregister(nodeType: string): void {
    this.executors.delete(nodeType);
  }

  /**
   * Checks if an executor is registered for a given node type.
   */
  has(nodeType: string): boolean {
    return this.executors.has(nodeType);
  }

  /**
   * Lists all currently registered node types.
   */
  listTypes(): string[] {
    return Array.from(this.executors.keys());
  }
}

export const executorRegistry = new ExecutorRegistry();
