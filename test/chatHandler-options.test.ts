import { describe, it, expect, vi, beforeEach } from "vitest";

const { streamText, resolveChatModel, logMessage, checkSpendCap } = vi.hoisted(() => ({
  streamText: vi.fn(),
  resolveChatModel: vi.fn(() => ({ modelId: "stub" })),
  logMessage: vi.fn(),
  checkSpendCap: vi.fn(async () => true),
}));

vi.mock("../server/model", () => ({
  resolveChatModel,
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

vi.mock("../server/spendcap", () => ({
  checkSpendCap,
  recordUsage: vi.fn(),
}));

vi.mock("../server/turso", () => ({ logMessage }));

import { createChatHandler } from "../server/chatHandler";
import type { ChatHandlerConfig } from "../server/types";

function req(body: unknown, headers?: Record<string, string>): Request {
  return new Request("https://x/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const userMsg = { id: "1", role: "user" as const, parts: [{ type: "text" as const, text: "hi" }] };

const v07Config: ChatHandlerConfig = {
  model: "claude-haiku-4-5",
  buildSystemPrompt: () => "sys",
  getTools: () => ({}),
  errorMessage: "Beklager, noe gikk galt.",
};

function lastStreamArgs() {
  expect(streamText).toHaveBeenCalled();
  return streamText.mock.calls[streamText.mock.calls.length - 1][0] as {
    model: unknown;
    messages: Array<{ role: string; content: string; providerOptions?: unknown }>;
    tools: Record<string, unknown>;
    onFinish: (arg: { text: string; totalUsage?: { totalTokens?: number } }) => Promise<void> | void;
  };
}

beforeEach(() => {
  streamText.mockReset();
  streamText.mockImplementation(() => ({
    toUIMessageStreamResponse: (opts?: { headers?: Record<string, string> }) =>
      new Response("ok", { status: 200, headers: opts?.headers }),
  }));
  resolveChatModel.mockClear();
  logMessage.mockClear();
  checkSpendCap.mockReset();
  checkSpendCap.mockResolvedValue(true);
});

describe("v0.7.x config is unchanged", () => {
  it("logs the user turn, caches a single system message, and uses anthropic", async () => {
    const getTools = vi.fn(() => ({ ping: { description: "p" } }));
    const handler = createChatHandler({
      ...v07Config,
      getTools,
    });
    const res = await handler(
      req({
        messages: [userMsg],
        referer: "https://example.com",
        pageUrl: "https://example.com/pris",
        pageTitle: "Pris",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(logMessage).toHaveBeenCalledTimes(1);
    expect(logMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "anonymous", role: "user", content: "hi" }),
    );
    expect(resolveChatModel).toHaveBeenCalledWith("claude-haiku-4-5", "anthropic", undefined);
    const args = lastStreamArgs();
    expect(args.messages.filter((m) => m.role === "system")).toHaveLength(1);
    expect(args.messages[0]).toMatchObject({
      role: "system",
      content: "sys",
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    });
    expect(getTools).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        referer: "https://example.com",
        page: { url: "https://example.com/pris", title: "Pris" },
        ip: "1.2.3.4",
      }),
    );
    expect(res.headers.get("X-Jev-Route")).toBeNull();
  });
});

describe("logMessages", () => {
  it("skips Turso when logMessages is false", async () => {
    const handler = createChatHandler({ ...v07Config, logMessages: false });
    await handler(req({ messages: [userMsg] }));
    expect(logMessage).not.toHaveBeenCalled();
    await lastStreamArgs().onFinish({ text: "hello" });
    expect(logMessage).not.toHaveBeenCalled();
  });

  it("lets a predicate skip specific sessions", async () => {
    const pred = vi.fn((info: { sessionId: string }) => !info.sessionId.startsWith("sok-"));
    const handler = createChatHandler({ ...v07Config, logMessages: pred });
    await handler(req({ messages: [userMsg], sessionId: "sok-abc" }));
    expect(pred).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "sok-abc" }));
    expect(logMessage).not.toHaveBeenCalled();
  });
});

describe("provider", () => {
  it("passes openai through resolveChatModel", async () => {
    const handler = createChatHandler({ ...v07Config, provider: "openai", model: "gpt-4.1-mini" });
    await handler(req({ messages: [userMsg] }));
    expect(resolveChatModel).toHaveBeenCalledWith("gpt-4.1-mini", "openai", undefined);
    const args = lastStreamArgs();
    expect(args.messages[0].providerOptions).toBeUndefined();
  });
});

describe("buildPageBlock", () => {
  it("sends a cached static block and an uncached page block", async () => {
    const handler = createChatHandler({
      ...v07Config,
      buildSystemPrompt: () => "STATIC",
      buildPageBlock: (page) => `PAGE:${page.url}|${page.title}`,
    });
    await handler(
      req({ messages: [userMsg], pageUrl: "https://ex/a", pageTitle: "A" }),
    );
    const systems = lastStreamArgs().messages.filter((m) => m.role === "system");
    expect(systems).toHaveLength(2);
    expect(systems[0]).toMatchObject({
      content: "STATIC",
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    });
    expect(systems[1]).toEqual({ role: "system", content: "PAGE:https://ex/a|A" });
    expect(systems[1].providerOptions).toBeUndefined();
  });
});

describe("prepareTurn", () => {
  it("adds an extra system block, headers, and can omit the host search tool", async () => {
    const search = { description: "host search" };
    const other = { description: "other" };
    const prepareTurn = vi.fn(async () => ({
      extraSystemBlock: "TURN-CTX",
      extraHeaders: { "X-Jev-Route": "semantic_search" },
      disableSearchTool: true,
    }));
    const handler = createChatHandler({
      ...v07Config,
      getTools: () => ({ search, other }),
      searchToolName: "search",
      prepareTurn,
    });
    const res = await handler(
      req({ messages: [userMsg], faq: true, sessionId: "s1" }),
    );
    expect(res.headers.get("X-Jev-Route")).toBe("semantic_search");
    expect(prepareTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s1",
        info: expect.objectContaining({ faq: true, ip: "1.2.3.4" }),
        tools: expect.objectContaining({ search, other }),
      }),
    );
    const args = lastStreamArgs();
    expect(args.tools.search).toBeUndefined();
    expect(args.tools.other).toBe(other);
    const systems = args.messages.filter((m) => m.role === "system");
    expect(systems.map((m) => m.content)).toEqual(["sys", "TURN-CTX"]);
  });
});

describe("checkAnswer", () => {
  it("reports via onStreamError and does not change the streamed body", async () => {
    const onStreamError = vi.fn();
    const checkAnswer = vi.fn(() => ({ message: "amount not in facts" }));
    const handler = createChatHandler({ ...v07Config, checkAnswer, onStreamError });
    const res = await handler(req({ messages: [userMsg] }));
    expect(await res.text()).toBe("ok");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await lastStreamArgs().onFinish({ text: "Det koster 99 kr" });
    expect(checkAnswer).toHaveBeenCalledWith(
      "Det koster 99 kr",
      expect.objectContaining({ text: "Det koster 99 kr" }),
    );
    expect(onStreamError).toHaveBeenCalledWith(expect.any(Error));
    expect((onStreamError.mock.calls[0][0] as Error).message).toBe("amount not in facts");
  });
});

describe("verifyRequest", () => {
  it("returns 401 when verification fails and does not call the model", async () => {
    const verifyRequest = vi.fn(async () => false);
    const handler = createChatHandler({ ...v07Config, verifyRequest });
    const res = await handler(req({ messages: [userMsg] }));
    expect(res.status).toBe(401);
    expect(streamText).not.toHaveBeenCalled();
    expect(verifyRequest).toHaveBeenCalled();
    const raw = verifyRequest.mock.calls[0][1] as string;
    expect(JSON.parse(raw).messages[0].id).toBe("1");
  });

  it("continues when verification succeeds", async () => {
    const handler = createChatHandler({
      ...v07Config,
      verifyRequest: async () => true,
    });
    const res = await handler(req({ messages: [userMsg] }));
    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalled();
  });
});

describe("RequestInfo extensions", () => {
  it("passes page, ip, and faq into getTools", async () => {
    const getTools = vi.fn(() => ({}));
    const handler = createChatHandler({ ...v07Config, getTools });
    await handler(
      req({
        messages: [userMsg],
        pageUrl: "https://ex/p",
        pageTitle: "P",
        faq: true,
      }),
    );
    expect(getTools.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        page: { url: "https://ex/p", title: "P" },
        ip: "1.2.3.4",
        faq: true,
      }),
    );
  });
});
