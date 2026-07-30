import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Regression guard for the 2026-07-30 outage: the Upstash database behind
// UPSTASH_REDIS_REST_URL was gone (DNS ENOTFOUND), `rl.limit()` threw, the
// rejection propagated out of the POST handler, and every chat request became a
// bare 500 with an empty body — the widget showed no reply and no error.

const limitMock = vi.fn();

vi.mock("@upstash/redis", () => ({ Redis: class {} }));
vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow = () => ({});
    limit = limitMock;
  }
  return { Ratelimit };
});

const ENV = {
  UPSTASH_REDIS_REST_URL: "https://dead-db.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token",
};

beforeEach(() => {
  vi.resetModules();
  limitMock.mockReset();
  Object.assign(process.env, ENV);
});

afterEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  vi.restoreAllMocks();
});

describe("checkRateLimit resilience", () => {
  it("degrades to the in-memory limiter instead of throwing when Upstash is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    limitMock.mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { code: "ENOTFOUND" }),
    );

    const { checkRateLimit } = await import("../server/ratelimit");
    const opts = { limit: 2, window: "60 s", prefix: "outage-a" };

    await expect(checkRateLimit("1.1.1.1", opts)).resolves.toBe(true);
    // Still enforces a limit while degraded — the outage must not fail open.
    expect(await checkRateLimit("1.1.1.1", opts)).toBe(true);
    expect(await checkRateLimit("1.1.1.1", opts)).toBe(false);
  });

  it("trips a circuit so a dead Redis is not re-dialed on every request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    limitMock.mockRejectedValue(new TypeError("fetch failed"));

    const { checkRateLimit } = await import("../server/ratelimit");
    const opts = { limit: 100, window: "60 s", prefix: "outage-b" };

    for (let i = 0; i < 6; i++) await checkRateLimit("2.2.2.2", opts);
    // Trips after 2 consecutive failures; the remaining calls skip Upstash.
    expect(limitMock).toHaveBeenCalledTimes(2);
  });

  it("logs one line per outage window, not one per request", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    limitMock.mockRejectedValue(new TypeError("fetch failed"));

    const { checkRateLimit } = await import("../server/ratelimit");
    const opts = { limit: 100, window: "60 s", prefix: "outage-c" };

    for (let i = 0; i < 5; i++) await checkRateLimit("3.3.3.3", opts);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it("recovers and uses Upstash again once it answers", async () => {
    const { checkRateLimit, __resetCircuitForTest } = await import("../server/ratelimit");
    __resetCircuitForTest();
    limitMock.mockResolvedValue({ success: true });

    const opts = { limit: 1, window: "60 s", prefix: "outage-d" };
    // limit=1 would block the 2nd call on the memory floor; Upstash says yes.
    expect(await checkRateLimit("4.4.4.4", opts)).toBe(true);
    expect(await checkRateLimit("4.4.4.4", opts)).toBe(true);
    expect(limitMock).toHaveBeenCalledTimes(2);
  });
});

describe("createChatHandler never returns a bare 500", () => {
  it("answers with the tenant errorMessage when the rate limiter blows up", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("../server/model", () => ({ resolveAnthropicModel: () => ({ modelId: "stub" }) }));
    vi.doMock("../server/turso", () => ({ logMessage: vi.fn() }));
    vi.doMock("../server/ratelimit", () => ({
      checkRateLimit: async () => {
        throw new TypeError("fetch failed");
      },
      getClientIp: () => "1.2.3.4",
    }));

    const { createChatHandler } = await import("../server/chatHandler");
    const onStreamError = vi.fn();
    const handler = createChatHandler({
      model: "claude-haiku-4-5",
      buildSystemPrompt: () => "sys",
      getTools: () => ({}),
      errorMessage: "Beklager, noe gikk galt.",
      onStreamError,
    });

    const res = await handler(
      new Request("https://x/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hei" }] }],
        }),
      }),
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Beklager, noe gikk galt.");
    expect(text).toContain('"type":"finish"');
    // Still reported — a graceful reply must not hide the fault from monitoring.
    expect(onStreamError).toHaveBeenCalled();
  });
});
