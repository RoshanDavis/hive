import { storage } from "./storage";

/**
 * Checks if a string matches a wildcard/glob pattern (e.g. "*localhost*")
 */
function matchesPattern(text: string, pattern: string): boolean {
  const regexPattern = "^" + pattern
    .replace(/[-[\]{}()+?.,\\^$|#\s]/g, "\\$&") // Escape regex special chars
    .replace(/\*/g, ".*")                      // Convert wildcard * to .*
    + "$";
  const regex = new RegExp(regexPattern, "i");
  return regex.test(text);
}

class ConcurrencyGovernor {
  // Map of active execution counts and waiting task resolves per logical execution pool
  private semaphores = new Map<string, { active: number; queue: (() => void)[] }>();

  /**
   * Helper to check if a model provider + base URL combination represents a local runner.
   * Compares the provider name and baseURL against the user's configured wildcard localPatterns.
   */
  isLocalModel(provider: string, baseURL?: string): boolean {
    const settings = storage.getConcurrencySettings();
    const patterns = settings.localPatterns || ["*localhost*", "*127.0.0.1*", "*[::1]*"];

    const searchTargets = [
      provider.toLowerCase(),
      (baseURL || "").toLowerCase()
    ].filter(Boolean);

    for (const target of searchTargets) {
      for (const pattern of patterns) {
        if (matchesPattern(target, pattern)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Enqueues and executes a task, guaranteeing it respects the dynamic concurrency limit for the specified execution pool.
   */
  async enqueue<T>(poolType: string, task: () => Promise<T>): Promise<T> {
    // Resolve legacy node-type calls to new pools for robust backward compatibility
    let resolvedPool = poolType.toLowerCase();
    if (resolvedPool === "ollama") {
      resolvedPool = "local";
    } else if (resolvedPool === "llm") {
      resolvedPool = "cloud"; // LLM nodes now call with resolved local/cloud pool, but default to cloud for legacy
    } else if (
      resolvedPool === "chat" ||
      resolvedPool === "notify" ||
      resolvedPool === "output" ||
      resolvedPool === "trigger" ||
      resolvedPool === "jsonstorage"
    ) {
      resolvedPool = "general";
    }

    const settings = storage.getConcurrencySettings();
    const config = (resolvedPool === "local" || resolvedPool === "cloud" || resolvedPool === "general")
      ? settings[resolvedPool]
      : { enabled: false, limit: 2 };

    if (!config.enabled) {
      // Concurrency limits disabled: execute immediately in parallel
      return task();
    }

    // Initialize semaphore state for this pool type if missing
    if (!this.semaphores.has(resolvedPool)) {
      this.semaphores.set(resolvedPool, { active: 0, queue: [] });
    }

    const sem = this.semaphores.get(resolvedPool)!;

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
   * Helper to check the current queue length for a given pool type.
   */
  getQueueLength(poolType: string): number {
    let resolvedPool = poolType.toLowerCase();
    if (resolvedPool === "ollama") resolvedPool = "local";
    else if (resolvedPool === "llm") resolvedPool = "cloud";
    else if (["chat", "notify", "output", "trigger", "jsonstorage"].includes(resolvedPool)) {
      resolvedPool = "general";
    }
    return this.semaphores.get(resolvedPool)?.queue.length || 0;
  }

  /**
   * Helper to check the active count for a given pool type.
   */
  getActiveCount(poolType: string): number {
    let resolvedPool = poolType.toLowerCase();
    if (resolvedPool === "ollama") resolvedPool = "local";
    else if (resolvedPool === "llm") resolvedPool = "cloud";
    else if (["chat", "notify", "output", "trigger", "jsonstorage"].includes(resolvedPool)) {
      resolvedPool = "general";
    }
    return this.semaphores.get(resolvedPool)?.active || 0;
  }
}

export const concurrencyGovernor = new ConcurrencyGovernor();
