import type { ToolSet, UIMessage } from "ai";
import type { AccessContext } from "./access-context";

export type RequestInfo = {
  messages: UIMessage[];
  referer: string | null;
};

export type ChatHandlerConfig = {
  /** Anthropic model id, e.g. "claude-haiku-4-5-20251001". */
  model: string;
  /** Build the system prompt from fetched content + current page context. */
  buildSystemPrompt: (content: string, page: { url: string; title: string }) => string;
  /** Fetch the knowledge content injected into the system prompt (live or static).
   *  Optional — omit when the content is already baked into buildSystemPrompt. */
  getContent?: () => Promise<string>;
  /** Per-client tool registry. Receives access context + per-request info. */
  getTools: (ctx: AccessContext, req: RequestInfo) => ToolSet;
  /** Override the access-control seam. Defaults to anonymous public. */
  resolveAccessContext?: (req: Request) => Promise<AccessContext>;
  /** Rate-limit knobs. Defaults: 10 / "60 s" / "chat". */
  rateLimit?: { limit?: number; window?: string; prefix?: string };
  /** Persist client IP in the conversation log (requires an `ip` column). Default false. */
  logIp?: boolean;
  /** User-facing fallback returned on a streaming error. */
  errorMessage: string;
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
