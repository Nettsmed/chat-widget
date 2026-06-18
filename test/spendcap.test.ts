import { describe, it, expect, beforeEach } from "vitest";
import { checkSpendCap, recordUsage, __resetMemoryForTest } from "../server/spendcap";

// Day boundary fixed via injected `now` so the test is deterministic.
const DAY1 = Date.UTC(2026, 5, 18, 10, 0, 0); // 2026-06-18
const DAY2 = Date.UTC(2026, 5, 19, 10, 0, 0); // 2026-06-19

describe("spendcap (in-memory fallback)", () => {
  beforeEach(() => __resetMemoryForTest());

  it("allows while under budget and blocks once at/over budget", async () => {
    const opts = { tenantKey: "nora", dailyTokens: 100, now: DAY1 };
    expect(await checkSpendCap(opts)).toBe(true);
    recordUsage(opts, 60);
    expect(await checkSpendCap(opts)).toBe(true); // 60 < 100
    recordUsage(opts, 50); // total 110 >= 100
    expect(await checkSpendCap(opts)).toBe(false);
  });

  it("resets on a new day", async () => {
    const d1 = { tenantKey: "nora", dailyTokens: 100, now: DAY1 };
    recordUsage(d1, 200);
    expect(await checkSpendCap(d1)).toBe(false);
    const d2 = { tenantKey: "nora", dailyTokens: 100, now: DAY2 };
    expect(await checkSpendCap(d2)).toBe(true);
  });

  it("isolates tenants", async () => {
    const a = { tenantKey: "nora", dailyTokens: 100, now: DAY1 };
    const b = { tenantKey: "solveig", dailyTokens: 100, now: DAY1 };
    recordUsage(a, 200);
    expect(await checkSpendCap(a)).toBe(false);
    expect(await checkSpendCap(b)).toBe(true);
  });
});
