import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the model layer so no network is touched.
vi.mock("../server/model", () => ({
  resolveAnthropicModel: vi.fn(() => ({ modelId: "stub" })),
}));

// streamText must not be reached when over budget; make it throw if called.
// Use vi.hoisted so the variable is available inside the vi.mock factory.
const { streamText } = vi.hoisted(() => ({
  streamText: vi.fn(() => {
    throw new Error("streamText should not be called when over spend cap");
  }),
}));
vi.mock("ai", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, streamText };
});
// Always allow rate limit; force spend cap exceeded.
vi.mock("../server/ratelimit", () => ({
  checkRateLimit: vi.fn(async () => true),
  getClientIp: vi.fn(() => "1.2.3.4"),
}));
vi.mock("../server/spendcap", () => ({
  checkSpendCap: vi.fn(async () => false), // over budget
  recordUsage: vi.fn(),
}));
vi.mock("../server/turso", () => ({ logMessage: vi.fn() }));

import { createChatHandler } from "../server/chatHandler";

function req(body: unknown): Request {
  return new Request("https://x/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("createChatHandler spend cap", () => {
  // Use void to prevent mockClear() return value (the mock itself) from being
  // registered as a vitest cleanup hook — mockClear returns `this`.
  beforeEach(() => void streamText.mockClear());

  it("returns the errorMessage and does NOT call the model when over budget", async () => {
    const handler = createChatHandler({
      model: "claude-haiku-4-5",
      buildSystemPrompt: () => "sys",
      getTools: () => ({}),
      errorMessage: "Tjenesten er midlertidig utilgjengelig.",
      spendCap: { tenantKey: "nora", dailyTokens: 1 },
    });
    const res = await handler(
      req({ messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }] }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Tjenesten er midlertidig utilgjengelig.");
    expect(streamText).not.toHaveBeenCalled();
  });
});
