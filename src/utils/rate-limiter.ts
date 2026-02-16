import type { Scheduler } from "./webflow.js";

/**
 * Lightweight rate limiter for the Webflow Data API v2.
 *
 * Enforces two constraints:
 *   1. Minimum spacing between requests (default: 1 050 ms)
 *   2. Token bucket with refill (default: 60 tokens, refills 1/sec)
 *
 * Requests are queued and executed sequentially — no concurrent requests.
 * This matches Webflow's rate limit model (60 req/min per token).
 *
 * Returns a `Scheduler` function compatible with all sync utilities.
 */
export function createRateLimiter(options?: {
  /** Minimum ms between requests (default: 1050) */
  minTime?: number;
  /** Starting token count (default: 60) */
  tokens?: number;
  /** Max token count (default: 60) */
  maxTokens?: number;
  /** How often to add a token, in ms (default: 1000) */
  refillInterval?: number;
}): Scheduler {
  const minTime = options?.minTime ?? 1_050;
  const maxTokens = options?.maxTokens ?? 60;
  const refillInterval = options?.refillInterval ?? 1_000;

  let tokens = options?.tokens ?? maxTokens;
  let lastRequestTime = 0;

  // Refill one token per interval, capped at maxTokens
  const refillTimer = setInterval(() => {
    if (tokens < maxTokens) tokens++;
  }, refillInterval);

  // Allow the process to exit even if the timer is still running
  if (refillTimer.unref) refillTimer.unref();

  // Wait until both constraints are satisfied
  async function waitForSlot(): Promise<void> {
    while (tokens <= 0) {
      await delay(refillInterval);
    }

    const now = Date.now();
    const elapsed = now - lastRequestTime;

    if (elapsed < minTime) {
      await delay(minTime - elapsed);
    }
  }

  // Sequential queue — only one request at a time
  let queue: Promise<void> = Promise.resolve();

  return <T>(fn: () => Promise<T>): Promise<T> => {
    // Chain onto the queue so requests run sequentially
    const result = queue.then(async () => {
      await waitForSlot();
      tokens--;
      lastRequestTime = Date.now();
      return fn();
    });

    // Update queue (swallow errors so the chain doesn't break)
    queue = result.then(
      () => {},
      () => {},
    );

    return result;
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
