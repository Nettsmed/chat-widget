import { anthropic } from "@ai-sdk/anthropic";
import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { checkRateLimit, getClientIp } from "./ratelimit";
import { logMessage } from "./turso";
import { resolveAccessContext as defaultResolveAccessContext } from "./access-context";
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

    const result = streamText({
      model: anthropic(cfg.model),
      system: cfg.buildSystemPrompt(content, { url: pageUrl, title: pageTitle }),
      messages: modelMessages,
      providerOptions: {
        anthropic: {
          cacheControl: { type: "ephemeral" },
        },
      },
      stopWhen: stepCountIs(stepCount),
      tools,
      onFinish: ({ text }) => {
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
