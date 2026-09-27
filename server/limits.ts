// Per-IP token buckets and a global in-flight cap, in memory. One process, one box — the
// same single-instance assumption the rest of the platform makes.

import type { IncomingMessage } from 'node:http';

export class TokenBuckets {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    /** burst size */
    readonly capacity: number,
    /** tokens added per second */
    readonly refillPerSec: number,
    /** entries kept before the idle ones are swept */
    readonly maxKeys = 10_000,
  ) {}

  /** Take one token. Returns 0 when allowed, else the seconds to wait. */
  take(key: string, now = Date.now()): number {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.sweep(now);
      b = { tokens: this.capacity, at: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSec);
    b.at = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - b.tokens) / this.refillPerSec);
  }

  /** Drop buckets that have refilled completely: they carry no information. */
  sweep(now = Date.now()): void {
    const full = (this.capacity / this.refillPerSec) * 1000;
    for (const [k, b] of this.buckets) if (now - b.at >= full) this.buckets.delete(k);
    // still full of active keys: evict the oldest rather than grow without bound
    if (this.buckets.size >= this.maxKeys) {
      const oldest = [...this.buckets.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, Math.ceil(this.maxKeys / 10));
      for (const [k] of oldest) this.buckets.delete(k);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

/**
 * The caller's address. Caddy strips any client-supplied X-Forwarded-For and sets its own,
 * so the first entry is the real remote address. Without Caddy (local runs) it is the socket.
 */
export function clientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}
