import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { streamText } = vi.hoisted(() => ({ streamText: vi.fn() }));

vi.mock("../server/model", () => ({
  resolveChatModel: vi.fn(() => ({ modelId: "stub" })),
  resolveAnthropicModel: vi.fn(() => ({ modelId: "stub" })),
}));
vi.mock("ai", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, streamText };
});
vi.mock("../server/ratelimit", () => ({
  checkRateLimit: vi.fn(async () => true),
  getClientIp: vi.fn(() => "1.2.3.4"),
}));
vi.mock("../server/spendcap", () => ({ checkSpendCap: vi.fn(async () => true), recordUsage: vi.fn() }));
vi.mock("../server/turso", () => ({ logMessage: vi.fn() }));

import { createChatHandler } from "../server/chatHandler";
import type { ChatHandlerConfig } from "../server/types";

const userMsg = { id: "1", role: "user" as const, parts: [{ type: "text" as const, text: "hi" }] };
const base: ChatHandlerConfig = {
  model: "claude-haiku-4-5",
  buildSystemPrompt: () => "sys",
  getTools: () => ({}),
  errorMessage: "err",
};
const usage = { totalTokens: 15, inputTokens: 10, outputTokens: 5, inputTokenDetails: { cacheReadTokens: 2 } };

function req(): Request {
  return new Request("https://x/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [userMsg], sessionId: "sess-1" }),
  });
}

async function finish(cfg: ChatHandlerConfig) {
  const res = await createChatHandler(cfg)(req());
  const args = streamText.mock.calls[streamText.mock.calls.length - 1][0] as {
    onFinish: (a: unknown) => Promise<void>;
  };
  await args.onFinish({ text: "answer", totalUsage: usage });
  return res;
}

const fetchMock = vi.fn();
beforeEach(() => {
  streamText.mockReset();
  streamText.mockImplementation(() => ({
    toUIMessageStreamResponse: () => new Response("ok", { status: 200 }),
  }));
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("posthog $ai_generation", () => {
  it("sends one content-free event with tokens, tenant and privacy flags", async () => {
    await finish({ ...base, posthog: { apiKey: "phc_x", tenant: "acme" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://eu.i.posthog.com/i/v0/e/");
    const body = JSON.parse(init.body);
    expect(body.event).toBe("$ai_generation");
    expect(body.api_key).toBe("phc_x");
    expect(body.distinct_id).toBe(body.properties.$ai_trace_id);
    expect(body.properties).toMatchObject({
      $ai_model: "claude-haiku-4-5",
      $ai_provider: "anthropic",
      $ai_input_tokens: 10,
      $ai_output_tokens: 5,
      tenant: "acme",
      $geoip_disable: true,
      $process_person_profile: false,
    });
    expect(typeof body.properties.$ai_latency).toBe("number");
    for (const k of ["$ai_input", "$ai_output_choices", "$ip"]) expect(body.properties).not.toHaveProperty(k);
    expect(JSON.stringify(body)).not.toContain("answer");
  });

  it("honours a custom host", async () => {
    await finish({ ...base, posthog: { apiKey: "k", host: "https://ph.example.com/" } });
    expect(fetchMock.mock.calls[0][0]).toBe("https://ph.example.com/i/v0/e/");
  });

  it("sends nothing without posthog config", async () => {
    await finish(base);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a rejecting fetch does not throw and is reported to onStreamError", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    const onStreamError = vi.fn();
    const res = await finish({ ...base, onStreamError, posthog: { apiKey: "k" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(res.status).toBe(200);
    expect(onStreamError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
  });

  it("a synchronously throwing fetch does not throw", async () => {
    fetchMock.mockImplementation(() => {
      throw new Error("sync");
    });
    const onStreamError = vi.fn();
    await finish({ ...base, onStreamError, posthog: { apiKey: "k" } });
    expect(onStreamError).toHaveBeenCalledTimes(1);
  });
});
