import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream, tool } from "ai";
import { z } from "zod";

const { resolveChatModel, logMessage, recordUsage } = vi.hoisted(() => ({
  resolveChatModel: vi.fn(),
  logMessage: vi.fn(),
  recordUsage: vi.fn(),
}));

vi.mock("../server/model", () => ({ resolveChatModel, resolveAnthropicModel: resolveChatModel }));
vi.mock("../server/ratelimit", () => ({
  checkRateLimit: vi.fn(async () => true),
  getClientIp: vi.fn(() => "1.2.3.4"),
}));
vi.mock("../server/spendcap", () => ({ checkSpendCap: vi.fn(async () => true), recordUsage }));
vi.mock("../server/turso", () => ({ logMessage }));

import { createChatHandler } from "../server/chatHandler";
import type { AfterTurnContext, ChatHandlerConfig } from "../server/types";

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

function chunks(parts: unknown[]) {
  return simulateReadableStream({ chunks: parts as never[] });
}

/** Step 1: a tool call. Step 2: final text. */
function toolThenTextModel() {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call++;
      if (call === 1) {
        return {
          stream: chunks([
            { type: "stream-start", warnings: [] },
            { type: "tool-call", toolCallId: "t1", toolName: "lookup", input: "{}" },
            { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
          ]),
        };
      }
      return {
        stream: chunks([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "x" },
          { type: "text-delta", id: "x", delta: "Hei " },
          { type: "text-delta", id: "x", delta: "verden" },
          { type: "text-end", id: "x" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage },
        ]),
      };
    },
  });
}

const tools = {
  lookup: tool({ description: "d", inputSchema: z.object({}), execute: async () => ({ ok: true }) }),
};

const base: ChatHandlerConfig = {
  model: "stub",
  buildSystemPrompt: () => "sys",
  getTools: () => tools,
  errorMessage: "Beklager",
  stepCount: 3,
};

function req() {
  return new Request("https://x/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }] }),
  });
}

/** Parses the SSE body into ordered chunk objects ("[DONE]" kept as a string). */
async function readParts(res: Response): Promise<Array<Record<string, unknown> | "[DONE]">> {
  return (await res.text())
    .split("\n\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice(6))
    .map((d) => (d === "[DONE]" ? "[DONE]" : (JSON.parse(d) as Record<string, unknown>)));
}

const types = (parts: Awaited<ReturnType<typeof readParts>>) =>
  parts.map((p) => (p === "[DONE]" ? p : (p.type as string)));

beforeEach(() => {
  resolveChatModel.mockReset();
  logMessage.mockClear();
  recordUsage.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("afterTurn", () => {
  it("writes data parts after the model parts and before finish", async () => {
    resolveChatModel.mockReturnValue(toolThenTextModel());
    let seen: AfterTurnContext | undefined;
    const handler = createChatHandler({
      ...base,
      afterTurn: (ctx) => {
        seen = ctx;
        ctx.writer.write({ type: "data-plan", id: "p1", data: { ops: [1] } });
      },
    });
    const parts = await readParts(await handler(req()));
    const t = types(parts);

    const lastText = t.lastIndexOf("text-end");
    const plan = t.indexOf("data-plan");
    expect(lastText).toBeGreaterThan(-1);
    expect(plan).toBeGreaterThan(lastText);
    expect(t.indexOf("tool-input-available")).toBeLessThan(plan);
    expect(t.filter((x) => x === "finish")).toHaveLength(1);
    expect(t[t.length - 2]).toBe("finish");
    expect(t[t.length - 1]).toBe("[DONE]");
    expect(t[t.length - 3]).toBe("data-plan");
    expect(t.filter((x) => x === "start")).toHaveLength(1);
    expect(parts[plan]).toMatchObject({ id: "p1", data: { ops: [1] } });

    expect(seen?.text).toBe("Hei verden");
    expect(seen?.steps).toBe(2);
    expect(seen?.toolCalls).toEqual(["lookup"]);
    expect(seen?.sessionId).toBe("anonymous");
    expect(seen?.info.page).toEqual({ url: "", title: "" });
  });

  it("still runs onFinish logic (spend cap, assistant log, checkAnswer)", async () => {
    resolveChatModel.mockReturnValue(toolThenTextModel());
    const checkAnswer = vi.fn();
    const handler = createChatHandler({
      ...base,
      spendCap: { tenantKey: "t", dailyTokens: 1000 },
      checkAnswer,
      afterTurn: () => {},
    });
    await readParts(await handler(req()));
    expect(recordUsage).toHaveBeenCalled();
    expect(checkAnswer).toHaveBeenCalledWith("Hei verden", expect.anything());
    expect(logMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: "assistant", content: "Hei verden" }),
    );
  });

  it("reports a throwing afterTurn via onStreamError and still finishes", async () => {
    resolveChatModel.mockReturnValue(toolThenTextModel());
    const onStreamError = vi.fn();
    const boom = new Error("boom");
    const handler = createChatHandler({
      ...base,
      onStreamError,
      afterTurn: () => {
        throw boom;
      },
    });
    const t = types(await readParts(await handler(req())));
    expect(onStreamError).toHaveBeenCalledWith(boom);
    expect(t).toContain("text-end");
    expect(t.slice(-2)).toEqual(["finish", "[DONE]"]);
    expect(t).not.toContain("data-plan");
  });

  it("without afterTurn the response is the plain toUIMessageStreamResponse", async () => {
    resolveChatModel.mockReturnValue(toolThenTextModel());
    const t = types(await readParts(await createChatHandler(base)(req())));
    expect(t.slice(-2)).toEqual(["finish", "[DONE]"]);
    expect(t.filter((x) => x === "finish")).toHaveLength(1);
  });

  it("applies prepareTurn extraHeaders to the afterTurn response", async () => {
    resolveChatModel.mockReturnValue(toolThenTextModel());
    const handler = createChatHandler({
      ...base,
      prepareTurn: () => ({ extraHeaders: { "X-Test": "1" } }),
      afterTurn: () => {},
    });
    const res = await handler(req());
    expect(res.headers.get("X-Test")).toBe("1");
    await res.text();
  });
});
