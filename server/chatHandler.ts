import { streamText, stepCountIs, convertToModelMessages, UI_MESSAGE_STREAM_HEADERS, type ToolSet, type UIMessage } from "ai";
import { checkRateLimit, getClientIp } from "./ratelimit";
import { logMessage } from "./turso";
import { resolveAccessContext as defaultResolveAccessContext } from "./access-context";
import { resolveChatModel } from "./model";
import { checkSpendCap, recordUsage } from "./spendcap";
import type {
  ChatHandlerConfig,
  CheckAnswerContext,
  LogMessagesInfo,
  PageInfo,
  PrepareTurnResult,
  RequestInfo,
} from "./types";

type ChatRequestBody = {
  messages: UIMessage[];
  referer?: string;
  sessionId?: string;
  pageUrl?: string;
  pageTitle?: string;
  faq?: boolean;
};

function textFromMessage(m: UIMessage): string {
  return (
    m.parts
      ?.filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("\n") ?? ""
  );
}

function shouldLogMessages(
  logMessages: ChatHandlerConfig["logMessages"],
  info: LogMessagesInfo,
): boolean {
  if (logMessages === undefined) return true;
  if (typeof logMessages === "boolean") return logMessages;
  return logMessages(info);
}

function omitTool(tools: ToolSet, name: string): ToolSet {
  if (!(name in tools)) return tools;
  const next = { ...tools };
  delete next[name];
  return next;
}

function checkAnswerIssue(result: unknown): string | undefined {
  if (result == null || result === true) return undefined;
  if (typeof result === "string") return result || undefined;
  if (typeof result === "object") {
    const obj = result as { message?: unknown; error?: unknown; ok?: unknown };
    if (obj.ok === false) {
      if (typeof obj.message === "string" && obj.message) return obj.message;
      if (typeof obj.error === "string" && obj.error) return obj.error;
      return "checkAnswer failed";
    }
    if (typeof obj.message === "string" && obj.message) return obj.message;
    if (typeof obj.error === "string" && obj.error) return obj.error;
  }
  return undefined;
}

/**
 * Emits a full UI-message stream carrying a single assistant text turn, so the
 * widget renders `message` as a normal reply instead of showing nothing. Chunk
 * order matches toUIMessageStreamResponse:
 *   start -> text-start -> text-delta -> text-end -> finish -> [DONE]
 */
function uiTextStreamResponse(message: string, id: string): Response {
  const body =
    `data: ${JSON.stringify({ type: "start", messageId: id })}\n\n` +
    `data: ${JSON.stringify({ type: "text-start", id })}\n\n` +
    `data: ${JSON.stringify({ type: "text-delta", id, delta: message })}\n\n` +
    `data: ${JSON.stringify({ type: "text-end", id })}\n\n` +
    `data: ${JSON.stringify({ type: "finish", finishReason: "stop" })}\n\n` +
    `data: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: UI_MESSAGE_STREAM_HEADERS });
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
  const provider = cfg.provider ?? "anthropic";
  const searchToolName = cfg.searchToolName ?? "search";

  // Last line of defence: any unexpected throw (a dead Redis, a tenant
  // `getTools`/`resolveAccessContext` blowing up) used to surface as a bare 500
  // with an empty body — the widget just sat there. Report it, then answer with
  // the tenant's error copy so the user always sees *something*.
  return async function POST(req: Request): Promise<Response> {
    try {
      return await handle(req);
    } catch (err) {
      console.error("[chat] unhandled handler failure:", err);
      cfg.onStreamError?.(err);
      return uiTextStreamResponse(cfg.errorMessage, "chat-handler-error");
    }
  };

  async function handle(req: Request): Promise<Response> {
    const ip = getClientIp(req);
    if (!(await checkRateLimit(ip, cfg.rateLimit))) {
      return new Response("Rate limit exceeded", { status: 429 });
    }

    let rawBody = "";
    try {
      rawBody = await req.text();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    if (cfg.verifyRequest) {
      let ok = false;
      try {
        ok = await cfg.verifyRequest(req, rawBody);
      } catch (err) {
        console.error("[chat] verifyRequest failed:", err);
        cfg.onStreamError?.(err);
        return new Response("Unauthorized", { status: 401 });
      }
      if (!ok) return new Response("Unauthorized", { status: 401 });
    }

    let body: ChatRequestBody;
    try {
      body = JSON.parse(rawBody) as ChatRequestBody;
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const { messages, referer, sessionId } = body;
    const page: PageInfo = {
      url: (body.pageUrl ?? "").slice(0, 300),
      title: (body.pageTitle ?? "").slice(0, 200),
    };
    const faq = body.faq === true ? true : body.faq === false ? false : undefined;
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

    const info: RequestInfo = {
      messages,
      referer: referer ?? null,
      page,
      ip,
      faq,
    };
    const persist = shouldLogMessages(cfg.logMessages, { ...info, sessionId: sid });

    const last = messages[messages.length - 1];
    if (persist && last && last.role === "user") {
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
      return uiTextStreamResponse(cfg.errorMessage, "spend-cap-error");
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

    const access = await resolveCtx(req);
    let tools = cfg.getTools(access, info);

    let turn: PrepareTurnResult | void = undefined;
    if (cfg.prepareTurn) {
      try {
        turn = await cfg.prepareTurn({ req, access, info, sessionId: sid, tools });
      } catch (err) {
        console.error("[chat] prepareTurn failed:", err);
        cfg.onStreamError?.(err);
      }
    }
    if (turn?.disableSearchTool) {
      tools = omitTool(tools, searchToolName);
    }

    const systemPrompt = cfg.buildSystemPrompt(content, page);
    const pageBlock = cfg.buildPageBlock?.(page) ?? "";
    const extraBlock = turn?.extraSystemBlock ?? "";

    type SystemMsg = {
      role: "system";
      content: string;
      providerOptions?: { anthropic: { cacheControl: { type: "ephemeral" } } };
    };
    const cachedSystem: SystemMsg = {
      role: "system",
      content: systemPrompt,
      ...(provider === "anthropic"
        ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" as const } } } }
        : {}),
    };

    const systemMessages: SystemMsg[] = [cachedSystem];
    if (cfg.buildPageBlock && pageBlock) {
      systemMessages.push({ role: "system", content: pageBlock });
    }
    if (extraBlock) {
      systemMessages.push({ role: "system", content: extraBlock });
    }

    const result = streamText({
      model: resolveChatModel(cfg.model, provider, cfg.apiKey),
      // Cache the (large, stable) system prompt via a cache breakpoint on the
      // system message — top-level providerOptions does NOT cache the system
      // string. Cuts input tokens ~70% on repeat turns. Page / per-turn blocks
      // stay uncached so they do not bust that breakpoint.
      messages: [...systemMessages, ...modelMessages],
      stopWhen: stepCountIs(stepCount),
      tools,
      onFinish: async ({ text, totalUsage }) => {
        if (cfg.spendCap && totalUsage?.totalTokens) {
          recordUsage(cfg.spendCap, totalUsage.totalTokens);
        }
        if (persist && text && last) {
          logMessage({
            sessionId: sid,
            messageId: `assistant-${last.id}`,
            role: "assistant",
            content: text,
            referer: referer ?? null,
            ip: logIpVal,
          });
        }
        if (cfg.checkAnswer && text) {
          const checkCtx: CheckAnswerContext = {
            req,
            access,
            info,
            sessionId: sid,
            tools,
            text,
          };
          try {
            const issue = checkAnswerIssue(await cfg.checkAnswer(text, checkCtx));
            if (issue) {
              console.error("[chat] checkAnswer:", issue);
              cfg.onStreamError?.(new Error(issue));
            }
          } catch (err) {
            console.error("[chat] checkAnswer failed:", err);
            cfg.onStreamError?.(err);
          }
        }
      },
      onError: ({ error }) => {
        console.error("[chat] stream error:", error);
        cfg.onStreamError?.(error);
      },
    });

    return result.toUIMessageStreamResponse({
      headers: turn?.extraHeaders,
      onError: (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[chat] response error:", msg);
        cfg.onStreamError?.(error);
        return cfg.errorMessage;
      },
    });
  }
}
