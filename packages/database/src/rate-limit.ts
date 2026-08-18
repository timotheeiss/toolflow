import { createHash } from "node:crypto";
import type { Pool } from "pg";

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(scope: string, key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  consume(scope: string, key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    validateRule(rule);
    const now = this.now();
    const bucketKey = `${scope}:${key}`;
    let bucket = this.buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + rule.windowMs };
      this.buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;
    if (this.buckets.size > 10_000) this.removeExpired(now);
    return Promise.resolve({
      allowed: bucket.count <= rule.limit,
      remaining: Math.max(0, rule.limit - bucket.count),
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    });
  }

  private removeExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

/** Atomic, process-independent fixed-window quota backed by the control database. */
export class PostgresRateLimiter implements RateLimiter {
  constructor(private readonly pool: Pool) {}

  async consume(scope: string, key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    validateRule(rule);
    if (!scope || scope.length > 100 || !key || key.length > 1_000) {
      throw new Error("Rate limit scope or key is invalid.");
    }
    const keyHash = createHash("sha256").update(key).digest("hex");
    const result = await this.pool.query<{ count: number; retry_after_seconds: number }>(
      `insert into rate_limit_buckets (scope, key_hash, count, reset_at, updated_at)
       values ($1, $2, 1, clock_timestamp() + ($3::bigint * interval '1 millisecond'), clock_timestamp())
       on conflict (scope, key_hash) do update set
         count = case
           when rate_limit_buckets.reset_at <= clock_timestamp() then 1
           else rate_limit_buckets.count + 1
         end,
         reset_at = case
           when rate_limit_buckets.reset_at <= clock_timestamp()
             then clock_timestamp() + ($3::bigint * interval '1 millisecond')
           else rate_limit_buckets.reset_at
         end,
         updated_at = clock_timestamp()
       returning count,
         greatest(1, ceil(extract(epoch from (reset_at - clock_timestamp()))))::integer
           as retry_after_seconds`,
      [scope, keyHash, rule.windowMs],
    );
    const bucket = result.rows[0];
    if (!bucket) throw new Error("Rate limit bucket update failed.");
    return {
      allowed: bucket.count <= rule.limit,
      remaining: Math.max(0, rule.limit - bucket.count),
      retryAfterSeconds: bucket.retry_after_seconds,
    };
  }
}

function validateRule(rule: RateLimitRule): void {
  if (
    !Number.isSafeInteger(rule.limit) ||
    rule.limit < 1 ||
    !Number.isSafeInteger(rule.windowMs) ||
    rule.windowMs < 1
  ) {
    throw new Error("Rate limit rule is invalid.");
  }
}
