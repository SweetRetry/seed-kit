const BASE_DELAY_MS = 1_000;
const MAX_ATTEMPTS = 3;

/**
 * Check if an error is retryable (transient network / rate-limit).
 * Returns a descriptive category or null if not retryable.
 */
export function classifyError(err: unknown): 'rate_limit' | 'network' | 'auth' | 'unknown' {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes('401') || lower.includes('invalid api key') || lower.includes('unauthorized')) {
    return 'auth';
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'rate_limit';
  }
  if (lower.includes('503') || lower.includes('service unavailable')) {
    return 'network';
  }
  if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('econnreset') ||
      lower.includes('etimedout') || lower.includes('fetch failed') || lower.includes('socket hang up')) {
    return 'network';
  }
  return 'unknown';
}

export function isRetryable(err: unknown): boolean {
  const cls = classifyError(err);
  return cls === 'rate_limit' || cls === 'network';
}

/**
 * Retry an async function with exponential backoff + jitter.
 * Only retries on transient errors (429, 503, network failures).
 *
 * @param fn - The async function to execute
 * @param onRetry - Optional callback fired before each retry with (attempt, delayMs, error)
 * @param signal - Optional AbortSignal to cancel retries
 * @returns The result of fn
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void,
  signal?: AbortSignal,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS || signal?.aborted) {
        throw err;
      }
      // Exponential backoff: 1s, 2s, 4s + jitter (±25%)
      const base = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      const jitter = base * 0.25 * (Math.random() * 2 - 1); // -25% to +25%
      const delay = Math.round(base + jitter);
      onRetry?.(attempt, delay, err);
      await sleep(delay, signal);
    }
  }
  throw lastErr;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
