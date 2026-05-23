import { storage } from "./storage";

class ConcurrencyGovernor {
  // Map of active execution counts and waiting task resolves per node type
  private semaphores = new Map<string, { active: number; queue: (() => void)[] }>();

  /**
   * Enqueues and executes a task, guaranteeing it respects the dynamic concurrency limit for the specified nodeType.
   */
  async enqueue<T>(nodeType: string, task: () => Promise<T>): Promise<T> {
    const settings = storage.getConcurrencySettings();
    const config = settings[nodeType] || { enabled: false, limit: 2 };

    if (!config.enabled) {
      // Concurrency limits disabled: execute immediately in parallel
      return task();
    }

    // Initialize semaphore state for this node type if missing
    if (!this.semaphores.has(nodeType)) {
      this.semaphores.set(nodeType, { active: 0, queue: [] });
    }

    const sem = this.semaphores.get(nodeType)!;

    // If max concurrency limit is reached, queue the task
    if (sem.active >= config.limit) {
      await new Promise<void>((resolve) => {
        sem.queue.push(resolve);
      });
    }

    // Consume a slot
    sem.active++;

    try {
      return await task();
    } finally {
      // Release slot
      sem.active--;

      // Dequeue next waiting task if available
      if (sem.queue.length > 0) {
        const next = sem.queue.shift()!;
        next();
      }
    }
  }

  /**
   * Helper to check the current queue length for a given node type.
   */
  getQueueLength(nodeType: string): number {
    return this.semaphores.get(nodeType)?.queue.length || 0;
  }

  /**
   * Helper to check the active count for a given node type.
   */
  getActiveCount(nodeType: string): number {
    return this.semaphores.get(nodeType)?.active || 0;
  }
}

export const concurrencyGovernor = new ConcurrencyGovernor();
