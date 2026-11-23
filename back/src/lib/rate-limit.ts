/**
 * Counts failed attempts per key inside a sliding window and blocks the key
 * once it reaches the limit. In-memory: per process on Node, per isolate on
 * Cloudflare Workers (where it is best-effort).
 */
export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
  ) {}

  private recent(key: string, now: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (kept.length > 0) this.failures.set(key, kept);
    else this.failures.delete(key);
    return kept;
  }

  /** Seconds until `key` may try again; 0 when it is not blocked. */
  retryAfterSeconds(key: string, now = Date.now()): number {
    const recent = this.recent(key, now);
    if (recent.length < this.maxFailures) return 0;
    return Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
  }

  recordFailure(key: string, now = Date.now()): void {
    this.failures.set(key, [...this.recent(key, now), now]);
    // Bound memory under a flood of distinct keys.
    if (this.failures.size > 10_000) {
      for (const candidate of this.failures.keys()) this.recent(candidate, now);
    }
  }

  reset(key?: string): void {
    if (key === undefined) this.failures.clear();
    else this.failures.delete(key);
  }
}
