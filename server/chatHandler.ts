import { streamText, stepCountIs, convertToModelMessages, UI_MESSAGE_STREAM_HEADERS, type UIMessage } from "ai";
import { checkRateLimit, getClientIp } from "./ratelimit";
import { logMessage } from "./turso";
import { resolveAccessContext as defaultResolveAccessContext } from "./access-context";
import { resolveAnthropicModel } from "./model";
import { checkSpendCap, recordUsage } from "./spendcap";
import type { ChatHandlerConfig } from "./types";

type ChatRequestBody = {
  messages: UIMessage[];
  referer?: string;
  sessionId?: string;
  pageUrl?: string;
  pageTitle?: string;
};

function textFromMessage(m: UIMessage): string {
  return (
    m.parts
      ?.filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("\n") ?? ""
  );
}

/**
 * Builds the generic POST handler for the chat endpoint. Everything tenant-
 * specific (model, system prompt, content source, tools, access seam, copy,
 * limits) is injected via config; the pipeline (rate-limit -> abuse guards ->
 * log -> stream -> tool loop) is shared.
 */
export function createChatHandler(cfg: ChatHandlerConfig) {
  const maxMessages = cfg.maxMessages ?? 30;
  const maxMsgChars = cfg.maxMsgChars ?? 4000;
  const maxTotalChars = cfg.maxTotalChars ?? 16000;
  const stepCount = cfg.stepCount ?? 3;
  const resolveCtx = cfg.resolveAccessContext ?? defaultResolveAccessContext;

  return async function POST(req: Request): Promise<Response> {
    const ip = getClientIp(req);
    if (!(await checkRateLimit(ip, cfg.rateLimit))) {
      return new Response("Rate limit exceeded", { status: 429 });
    }

    let body: ChatRequestBody;
    try {
      body = (await req.json()) as ChatRequestBody;
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const { messages, referer, sessionId } = body;
    const pageUrl = (body.pageUrl ?? "").slice(0, 300);
    const pageTitle = (body.pageTitle ?? "").slice(0, 200);
    const sid = sessionId || "anonymous";
    const logIpVal = cfg.logIp ? ip : undefined;

    if (!Array.isArray(messages) || messages.length === 0 || messages.length > maxMessages) {
      return new Response("Bad request", { status: 400 });
    }
    let totalChars = 0;
    for (const m of messages) {
      const len = textFromMessage(m).length;
      if (len > maxMsgChars) return new Response("Message too long", { status: 400 });
      totalChars += len;
    }
    if (totalChars > maxTotalChars) return new Response("Conversation too long", { status: 400 });

    const last = messages[messages.length - 1];
    if (last && last.role === "user") {
      logMessage({
        sessionId: sid,
        messageId: last.id,
        role: "user",
        content: textFromMessage(last),
        referer: referer ?? null,
        ip: logIpVal,
      });
    }

    // Per-tenant spend cap: short-circuit before any model call.
    if (cfg.spendCap && !(await checkSpendCap(cfg.spendCap))) {
      // Emit a full UI-message stream so the widget renders the error as a
      // normal assistant turn. Chunk order matches toUIMessageStreamResponse:
      //   start -> text-start -> text-delta -> text-end -> finish -> [DONE]
      const id = "spend-cap-error";
      const body =
        `data: ${JSON.stringify({ type: "start", messageId: id })}\n\n` +
        `data: ${JSON.stringify({ type: "text-start", id })}\n\n` +
        `data: ${JSON.stringify({ type: "text-delta", id, delta: cfg.errorMessage })}\n\n` +
        `data: ${JSON.stringify({ type: "text-end", id })}\n\n` +
        `data: ${JSON.stringify({ type: "finish", finishReason: "stop" })}\n\n` +
        `data: [DONE]\n\n`;
      return new Response(body, {
        status: 200,
        headers: UI_MESSAGE_STREAM_HEADERS,
      });
    }

    let modelMessages;
    try {
      modelMessages = await convertToModelMessages(messages);
    } catch (err) {
      console.error("[chat] convertToModelMessages failed:", err);
      return new Response("Invalid messages", { status: 400 });
    }

    let content = "";
    if (cfg.getContent) {
      try {
        content = await cfg.getContent();
      } catch (err) {
        // Don't silently answer ungrounded on a knowledge-source outage — report it.
        console.error("[chat] content fetch failed:", err);
        cfg.onStreamError?.(err);
      }
    }

    const ctx = await resolveCtx(req);
    const tools = cfg.getTools(ctx, { messages, referer: referer ?? null });
    const systemPrompt = cfg.buildSystemPrompt(content, { url: pageUrl, title: pageTitle });

    const result = streamText({
      model: resolveAnthropicModel(cfg.model, cfg.apiKey),
      // Cache the (large, stable) system prompt via a cache breakpoint on the
      // system message — top-level providerOptions does NOT cache the system
      // string. Cuts input tokens ~70% on repeat turns.
      messages: [
        {
          role: "system",
          content: systemPrompt,
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
        ...modelMessages,
      ],
      stopWhen: stepCountIs(stepCount),
      tools,
      onFinish: ({ text, totalUsage }) => {
        if (cfg.spendCap && totalUsage?.totalTokens) {
          recordUsage(cfg.spendCap, totalUsage.totalTokens);
        }
        if (text && last) {
          logMessage({
            sessionId: sid,
            messageId: `assistant-${last.id}`,
            role: "assistant",
            content: text,
            referer: referer ?? null,
            ip: logIpVal,
          });
        }
      },
      onError: ({ error }) => {
        console.error("[chat] stream error:", error);
        cfg.onStreamError?.(error);
      },
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[chat] response error:", msg);
        cfg.onStreamError?.(error);
        return cfg.errorMessage;
      },
    });
  };
}
