import { describe, it, expect } from "vitest";
import { getClientIp, checkRateLimit } from "../server/ratelimit";

function req(headers: Record<string, string>): Request {
  return new Request("https://x.test/api/chat", { headers });
}

describe("getClientIp", () => {
  it("prefers unspoofable x-real-ip over client-appendable x-forwarded-for", () => {
    expect(
      getClientIp(req({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "evil, 2.2.2.2" })),
    ).toBe("1.1.1.1");
  });
  it("uses x-vercel-forwarded-for when x-real-ip absent", () => {
    expect(getClientIp(req({ "x-vercel-forwarded-for": "3.3.3.3" }))).toBe("3.3.3.3");
  });
  it("falls back to first x-forwarded-for hop, else 'unknown'", () => {
    expect(getClientIp(req({ "x-forwarded-for": "4.4.4.4, 5.5.5.5" }))).toBe("4.4.4.4");
    expect(getClientIp(req({}))).toBe("unknown");
  });
});

describe("checkRateLimit (in-memory floor, no Upstash env)", () => {
  it("allows up to the limit then blocks — never fails open", async () => {
    const opts = { limit: 3, window: "60 s", prefix: "test-a" };
    const ip = "9.9.9.9";
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) results.push(await checkRateLimit(ip, opts));
    expect(results).toEqual([true, true, true, false, false]);
  });
  it("buckets are keyed per prefix+ip (different ip not affected)", async () => {
    const opts = { limit: 1, window: "60 s", prefix: "test-b" };
    expect(await checkRateLimit("a", opts)).toBe(true);
    expect(await checkRateLimit("a", opts)).toBe(false);
    expect(await checkRateLimit("b", opts)).toBe(true); // distinct ip still allowed
  });
});
