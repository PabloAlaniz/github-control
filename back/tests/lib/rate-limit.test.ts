import { describe, it, expect } from 'vitest';
import { AttemptLimiter } from '@back/lib/rate-limit';

describe('AttemptLimiter', () => {
  it('blocks a key at the limit and releases it when the window passes', () => {
    const limiter = new AttemptLimiter(3, 60_000);
    const t0 = 1_000_000;
    limiter.recordFailure('a', t0);
    limiter.recordFailure('a', t0 + 10_000);
    expect(limiter.retryAfterSeconds('a', t0 + 10_000)).toBe(0);
    limiter.recordFailure('a', t0 + 20_000);

    expect(limiter.retryAfterSeconds('a', t0 + 20_000)).toBe(40); // until the first failure expires
    expect(limiter.retryAfterSeconds('b', t0 + 20_000)).toBe(0);
    expect(limiter.retryAfterSeconds('a', t0 + 60_000)).toBe(0);
  });

  it('can be reset per key or entirely', () => {
    const limiter = new AttemptLimiter(1, 60_000);
    limiter.recordFailure('a', 0);
    limiter.recordFailure('b', 0);
    limiter.reset('a');
    expect(limiter.retryAfterSeconds('a', 1)).toBe(0);
    expect(limiter.retryAfterSeconds('b', 1)).toBeGreaterThan(0);
    limiter.reset();
    expect(limiter.retryAfterSeconds('b', 1)).toBe(0);
  });
});
