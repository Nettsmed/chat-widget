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

import { maskPii } from "../server/posthog";

describe("maskPii", () => {
  const cases: [string, string][] = [
    ["mail meg på ola.nordmann@firma.no takk", "mail meg på [e-post] takk"],
    ["ring 91234567", "ring [telefon]"],
    ["ring +47 912 34 567", "ring [telefon]"],
    ["ring 0047 91234567", "ring [telefon]"],
    ["ring 912 34 567", "ring [telefon]"],
    ["ring 91 23 45 67", "ring [telefon]"],
    ["ring +46 70 123 45 67", "ring [telefon]"],
    ["org 123456789", "org [org.nr]"],
    ["org 123 456 789", "org [org.nr]"],
    ["kort 4111 1111 1111 1111", "kort [nummer]"],
    ["konto 1234-56-78901", "konto [nummer]"],
    ["Den koster 699 kr", "Den koster 699 kr"],
    ["Den koster 4 799 kr", "Den koster 4 799 kr"],
    ["Fra 1 790 per måned", "Fra 1 790 per måned"],
    ["Siden 2024 og 2025", "Siden 2024 og 2025"],
  ];
  it.each(cases)("%s", (input, expected) => {
    expect(maskPii(input)).toBe(expected);
  });
});

describe("posthog captureContent", () => {
  it("sends masked input and output, no system prompt", async () => {
    const r = new Request("https://x/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "sess-1",
        messages: [
          { id: "1", role: "user", parts: [{ type: "text", text: "mail ola@firma.no, ring 91234567. Pris?" }] },
        ],
      }),
    });
    const cfg = { ...base, buildSystemPrompt: () => "SECRET-SYSTEM", posthog: { apiKey: "k", captureContent: true } };
    await createChatHandler(cfg)(r);
    const args = streamText.mock.calls[0][0] as { onFinish: (a: unknown) => Promise<void> };
    await args.onFinish({ text: "Send til kari@x.no. Den koster 699 kr " + "a".repeat(5000), totalUsage: usage });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.properties.$ai_input).toEqual([{ role: "user", content: "mail [e-post], ring [telefon]. Pris?" }]);
    const out = body.properties.$ai_output_choices;
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("assistant");
    expect(out[0].content.startsWith("Send til [e-post]. Den koster 699 kr ")).toBe(true);
    expect(out[0].content.length).toBe(4000);
    expect(JSON.stringify(body)).not.toContain("SECRET-SYSTEM");
    expect(JSON.stringify(body)).not.toContain("ola@firma.no");
  });

  it("unset: no content keys", async () => {
    await finish({ ...base, posthog: { apiKey: "k" } });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.properties).not.toHaveProperty("$ai_input");
    expect(body.properties).not.toHaveProperty("$ai_output_choices");
  });
});
