/** Sliding-window limiter: at most `limit` actions per `windowMs` per user. */
export class RateLimiter {
  private hits = new Map<number, number[]>();

  constructor(private limit: number, private windowMs = 60_000) {}

  check(userId: number, now = Date.now()): { ok: true } | { ok: false; retryInSec: number } {
    const recent = (this.hits.get(userId) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? now;
      this.hits.set(userId, recent);
      return { ok: false, retryInSec: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.hits.set(userId, recent);
    return { ok: true };
  }
}
