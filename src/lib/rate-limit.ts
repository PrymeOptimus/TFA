/**
 * In-memory sliding-window rate limiter. Fine for a single-instance deploy;
 * swap for a Redis/Upstash-backed limiter (identical interface) before
 * scaling to multiple serverless regions/instances.
 */

const buckets = new Map<string, number[]>();

const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX ?? 60);
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const timestamps = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  const allowed = timestamps.length < MAX_REQUESTS;

  if (allowed) {
    timestamps.push(now);
  }
  buckets.set(key, timestamps);

  return {
    allowed,
    remaining: Math.max(0, MAX_REQUESTS - timestamps.length),
    resetAt: windowStart + WINDOW_MS,
  };
}

/** Convenience helper for API routes: derives a key from IP + route path. */
export function rateLimitKeyFromRequest(req: Request, scope: string): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";
  return `${scope}:${ip}`;
}
