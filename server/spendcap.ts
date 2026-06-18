import { Redis } from "@upstash/redis";
import { runBackground } from "./scheduler";

export type SpendCapOptions = {
  /** Stable per-tenant identifier (e.g. "nora", "solveig", "tilbud"). */
  tenantKey: string;
  /** Daily token budget for this tenant. */
  dailyTokens: number;
  /** Injectable clock (ms). Defaults to Date.now(). */
  now?: number;
};

let redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

function dayKey(o: SpendCapOptions): string {
  const d = new Date(o.now ?? Date.now());
  const ymd = d.toISOString().slice(0, 10);
  return `spend:${o.tenantKey}:${ymd}`;
}

// In-memory floor (per serverless instance). Distributed accuracy needs Upstash.
const mem = new Map<string, number>();
export function __resetMemoryForTest(): void {
  mem.clear();
}

/** True if the tenant is under its daily token budget. Fails closed on error. */
export async function checkSpendCap(o: SpendCapOptions): Promise<boolean> {
  const key = dayKey(o);
  const r = getRedis();
  if (r) {
    try {
      const used = (await r.get<number>(key)) ?? 0;
      return used < o.dailyTokens;
    } catch (err) {
      console.error("[spendcap] check failed (failing closed):", err);
      return false;
    }
  }
  return (mem.get(key) ?? 0) < o.dailyTokens;
}

/** Increment the tenant's daily token counter. Background, never throws. */
export function recordUsage(o: SpendCapOptions, tokens: number): void {
  if (!tokens || tokens <= 0) return;
  const key = dayKey(o);
  const r = getRedis();
  if (r) {
    runBackground(
      (async () => {
        await r.incrby(key, tokens);
        await r.expire(key, 60 * 60 * 26); // ~26h TTL so the day's key self-cleans
      })(),
    );
    return;
  }
  mem.set(key, (mem.get(key) ?? 0) + tokens);
}
