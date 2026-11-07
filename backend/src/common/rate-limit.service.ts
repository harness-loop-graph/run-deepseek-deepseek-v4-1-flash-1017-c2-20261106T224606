import { Injectable, OnModuleDestroy } from '@nestjs/common';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counters used by the two rate limits of RF-14.
 *
 * Authentication limits only count *failed* attempts: a caller that proves
 * who they are clears its bucket, while an attacker is stopped after the
 * configured number of failures inside the window.
 */
@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly buckets = new Map<string, Bucket>();
  private readonly timer: NodeJS.Timeout;

  constructor() {
    this.timer = setInterval(() => this.prune(), 60_000);
    this.timer.unref();
  }

  /** Returns the seconds to wait when the bucket is already exhausted. */
  peek(key: string, limit: number, windowMs: number, now = Date.now()): number | null {
    const bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= now) {
      return null;
    }
    if (bucket.count < limit) {
      return null;
    }
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }

  /** Counts one attempt and returns the seconds to wait when it is over the limit. */
  consume(key: string, limit: number, windowMs: number, now = Date.now()): number | null {
    const bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return null;
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    }
    return null;
  }

  /** Clears a bucket, for instance after a successful authentication. */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
