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

/** Well-known pool names that the governor manages */
type ConcurrencyPool = "local" | "cloud" | "general";

/**
 * Resolves a raw pool type string to a canonical pool name.
 * Legacy node type names (e.g. "ollama", "chat") are mapped to their
 * correct pool for backward compatibility.
 */
function resolvePool(poolType: string): ConcurrencyPool {
  const lower = poolType.toLowerCase();
  if (lower === "local" || lower === "ollama") return "local";
  if (lower === "cloud" || lower === "llm") return "cloud";
  return "general";
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
    const resolvedPool = resolvePool(poolType);
    const settings = storage.getConcurrencySettings();
    const config = settings[resolvedPool] || { enabled: false, limit: 2 };

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
    return this.semaphores.get(resolvePool(poolType))?.queue.length || 0;
  }

  /**
   * Helper to check the active count for a given pool type.
   */
  getActiveCount(poolType: string): number {
    return this.semaphores.get(resolvePool(poolType))?.active || 0;
  }
}

export const concurrencyGovernor = new ConcurrencyGovernor();
