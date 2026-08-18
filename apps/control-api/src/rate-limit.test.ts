import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "./rate-limit.js";

describe("InMemoryRateLimiter", () => {
  it("isolates quotas by scope, organization, and actor key", async () => {
    const limiter = new InMemoryRateLimiter(() => 1_000);
    const rule = { limit: 1, windowMs: 60_000 };
    expect((await limiter.consume("read", "org-a:user-a", rule)).allowed).toBe(true);
    expect((await limiter.consume("read", "org-a:user-a", rule)).allowed).toBe(false);
    expect((await limiter.consume("read", "org-a:user-b", rule)).allowed).toBe(true);
    expect((await limiter.consume("read", "org-b:user-a", rule)).allowed).toBe(true);
    expect((await limiter.consume("write", "org-a:user-a", rule)).allowed).toBe(true);
  });

  it("resets a fixed window and supplies a retry delay", async () => {
    let now = 1_000;
    const limiter = new InMemoryRateLimiter(() => now);
    const rule = { limit: 1, windowMs: 10_000 };
    await limiter.consume("export", "org:user", rule);
    const denied = await limiter.consume("export", "org:user", rule);
    expect(denied).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 10 });
    now = 11_000;
    expect((await limiter.consume("export", "org:user", rule)).allowed).toBe(true);
  });
});
