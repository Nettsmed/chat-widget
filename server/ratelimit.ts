import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitOptions = {
  limit?: number;
  window?: string; // e.g. "60 s"
  prefix?: string;
};

const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW = "60 s";
const DEFAULT_PREFIX = "chat";

const limiters = new Map<string, Ratelimit | null>();

function getUpstash(limit: number, window: string, prefix: string): Ratelimit | null {
  const key = `${prefix}:${limit}:${window}`;
  const cached = limiters.get(key);
  if (cached !== undefined) return cached;

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  let rl: Ratelimit | null = null;
  if (url && token) {
    rl = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(limit, window as `${number} s`),
      analytics: false,
      prefix,
    });
  }
  limiters.set(key, rl);
  return rl;
}

// Per-instance in-memory sliding window so rate limiting NEVER fails open,
// even without Upstash. (Distributed limiting needs Upstash; this is the floor.)
const hits = new Map<string, number[]>();
function memoryAllow(bucketKey: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(bucketKey) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    hits.set(bucketKey, arr);
    return false;
  }
  arr.push(now);
  hits.set(bucketKey, arr);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  }
  return true;
}

/** Returns true if the request is allowed. Always enforces a limit (never fails open). */
export async function checkRateLimit(ip: string, opts: RateLimitOptions = {}): Promise<boolean> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const window = opts.window ?? DEFAULT_WINDOW;
  const prefix = opts.prefix ?? DEFAULT_PREFIX;
  const windowMs = (parseInt(window, 10) || 60) * 1000;

  const rl = getUpstash(limit, window, prefix);
  if (rl) {
    const { success } = await rl.limit(ip);
    return success;
  }
  return memoryAllow(`${prefix}:${ip}`, limit, windowMs);
}

export function getClientIp(req: Request): string {
  // Prefer platform-set headers (Vercel sets x-real-ip / x-vercel-forwarded-for
  // server-side — the client cannot spoof them). x-forwarded-for is client-
  // appendable, so it's only a last resort for keying the rate limiter.
  const real = req.headers.get("x-real-ip") || req.headers.get("x-vercel-forwarded-for");
  if (real) return real.split(",")[0].trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}
