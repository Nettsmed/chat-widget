import type { ToolSet, UIMessage } from "ai";
import type { AccessContext } from "./access-context";
import type { SpendCapOptions } from "./spendcap";

export type ChatProvider = "anthropic" | "openai";

export type PageInfo = {
  url: string;
  title: string;
};

export type RequestInfo = {
  messages: UIMessage[];
  referer: string | null;
  page: PageInfo;
  ip: string;
  faq?: boolean;
};

/** Input to `logMessages` when it is a predicate. */
export type LogMessagesInfo = RequestInfo & {
  sessionId: string;
};

export type PrepareTurnContext = {
  req: Request;
  access: AccessContext;
  info: RequestInfo;
  sessionId: string;
  tools: ToolSet;
};

export type PrepareTurnResult = {
  /** Uncached extra system message for this turn only. */
  extraSystemBlock?: string;
  /** Merged onto the streaming Response (e.g. a routing header the widget reads). */
  extraHeaders?: Record<string, string>;
  /**
   * When true, omit `searchToolName` from the tool set for this turn.
   * The engine does not run search; the host decides the flag and the tool key.
   */
  disableSearchTool?: boolean;
};

export type CheckAnswerContext = PrepareTurnContext & {
  text: string;
};

export type ChatHandlerConfig = {
  /** Model id, e.g. "claude-haiku-4-5-20251001" or an OpenAI model id. */
  model: string;
  /** Inference provider. Default `"anthropic"` (v0.7.x behavior). */
  provider?: ChatProvider;
  /** Build the system prompt from fetched content + current page context. */
  buildSystemPrompt: (content: string, page: PageInfo) => string;
  /**
   * Optional uncached system block for the current page. When set, the handler
   * sends `buildSystemPrompt` as a cached system message and this block as a
   * second, uncached system message so page changes do not bust the cache.
   */
  buildPageBlock?: (page: PageInfo) => string;
  /** Fetch the knowledge content injected into the system prompt (live or static).
   *  Optional — omit when the content is already baked into buildSystemPrompt. */
  getContent?: () => Promise<string>;
  /** Per-client tool registry. Receives access context + per-request info. */
  getTools: (ctx: AccessContext, req: RequestInfo) => ToolSet;
  /**
   * Tool key dropped when `prepareTurn` returns `disableSearchTool: true`.
   * Host-defined; default `"search"`. The engine has no search implementation.
   */
  searchToolName?: string;
  /**
   * Per-turn hook after tools are built. May add a system block, response
   * headers, and/or disable a host-named tool for this turn.
   */
  prepareTurn?: (
    ctx: PrepareTurnContext,
  ) => PrepareTurnResult | void | Promise<PrepareTurnResult | void>;
  /**
   * Runs after the model finishes. Report issues via throw/return value;
   * the streamed answer is never mutated.
   */
  checkAnswer?: (
    text: string,
    ctx: CheckAnswerContext,
  ) => unknown | Promise<unknown>;
  /**
   * When set, called with the raw body before JSON parse. Return false to
   * reject with 401 (signed/HMAC callers).
   */
  verifyRequest?: (req: Request, rawBody: string) => boolean | Promise<boolean>;
  /**
   * Persist conversation turns to Turso. Default true (v0.7.x).
   * A predicate is evaluated once per request.
   */
  logMessages?: boolean | ((info: LogMessagesInfo) => boolean);
  /** Override the access-control seam. Defaults to anonymous public. */
  resolveAccessContext?: (req: Request) => Promise<AccessContext>;
  /** Rate-limit knobs. Defaults: 10 / "60 s" / "chat". */
  rateLimit?: { limit?: number; window?: string; prefix?: string };
  /** Persist client IP in the conversation log (requires an `ip` column). Default false. */
  logIp?: boolean;
  /** User-facing fallback returned on a streaming error. */
  errorMessage: string;
  /** Per-tenant API key (BYOK). When omitted, the provider env-default is used. */
  apiKey?: string;
  /** Per-tenant daily token budget. When set and exceeded, the handler returns
   *  the errorMessage instead of calling the model (protects against runaway
   *  cost / abuse). Omit to disable. */
  spendCap?: Omit<SpendCapOptions, "now">;
  /** Called on a stream/response error so the app can report it (e.g. Sentry).
   *  The package stays Sentry-agnostic; the app wires the reporter. */
  onStreamError?: (err: unknown) => void;
  /** Max tool-call steps. Default 3. */
  stepCount?: number;
  /** Abuse guards. Defaults: 30 / 4000 / 16000. */
  maxMessages?: number;
  maxMsgChars?: number;
  maxTotalChars?: number;
};
