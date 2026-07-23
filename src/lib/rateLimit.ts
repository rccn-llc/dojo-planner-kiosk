/**
 * Small fixed-window rate limiter.
 *
 * Backed by Upstash Redis when configured (works across serverless instances),
 * falling back to an in-memory map for local dev. Callers get a single boolean:
 * `true` = allowed, `false` = over the limit for the current window.
 *
 * NOTE: the in-memory fallback is per-instance only and must not be relied on
 * as a security control in a multi-instance deployment — configure Redis in
 * production. See [[otp]] which shares the same Redis client shape.
 */

interface WindowEntry {
  count: number;
  windowStart: number;
}

interface RateLimitGlobals {
  __kioskRateLimitStore?: Map<string, WindowEntry>;
}
const rlGlobals = globalThis as typeof globalThis & RateLimitGlobals;
const memoryStore: Map<string, WindowEntry>
  = rlGlobals.__kioskRateLimitStore ?? (rlGlobals.__kioskRateLimitStore = new Map<string, WindowEntry>());

function getRedisClient() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return import('@upstash/redis').then(({ Redis }) =>
      new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      }),
    );
  }
  return null;
}

/**
 * Returns true if the action is allowed for `key`, false if the caller has
 * already made `limit` attempts within the current `windowMs` window.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const redis = getRedisClient();
  if (redis) {
    const client = await redis;
    const redisKey = `rl:${key}`;
    const n = await client.incr(redisKey);
    if (n === 1) {
      await client.expire(redisKey, Math.ceil(windowMs / 1000));
    }
    return n <= limit;
  }

  const now = Date.now();
  const entry = memoryStore.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    memoryStore.set(key, { count: 1, windowStart: now });
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}

/**
 * Best-effort client IP from proxy headers. Behind Caddy/Vercel the real client
 * is in x-forwarded-for (first hop); falls back to a constant so a missing
 * header degrades to a shared bucket rather than throwing.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}
