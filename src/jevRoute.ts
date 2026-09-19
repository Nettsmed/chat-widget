/**
 * Live «Søker …» while the Spør KI backend routes via Jev.
 *
 * Contract (companion nettsmed-site): when Jev ran, the chat Response carries
 *   X-Jev-Route: prompt_only | semantic_search | ask_clarify | off | error_fallback
 *   X-Jev-Gated: 0 | 1
 *   X-Jev-Latency-Ms: <int>
 *
 * `@ai-sdk/react` `useChat` does not surface response headers (`onResponse` was
 * removed in AI SDK 5). `DefaultChatTransport` does accept a custom `fetch`,
 * and that Response's headers are readable as soon as `fetch` resolves — before
 * the body stream is consumed. That is the path this package uses.
 *
 * Fallback, if the site streams the route instead of (or before) a readable
 * header: a UI-message data part
 *   { type: "data-jev-route", data: { route: "semantic_search" }, transient?: true }
 *   or data: "semantic_search"
 * Transient parts only arrive via `onData`; persisted parts also show up on
 * the assistant message. Unknown / missing route keeps the typing dots.
 * `X-Jev-Gated` and `X-Jev-Latency-Ms` are observability for the site, not UI.
 */

export const JEV_ROUTES = [
  "prompt_only",
  "semantic_search",
  "ask_clarify",
  "off",
  "error_fallback",
] as const;

export type JevRoute = (typeof JEV_ROUTES)[number];

export const JEV_ROUTE_HEADER = "X-Jev-Route";

/** AI SDK data-part type. Prefix `data-` is required by the UI message stream. */
export const JEV_ROUTE_DATA_TYPE = "data-jev-route";

/** Generic search status. Site-specific copy is `SEARCHING_ON_SITE_LABEL`. */
export const SEARCHING_LABEL = "Søker …";

/** Used when the parent page (embed `?ctx`) is nettsmed.no. */
export const SEARCHING_ON_SITE_LABEL = "Søker på nettsmed.no …";

/** Existing typing indicator. Not a search, and not a new «Svarer …» state. */
export const TYPING_SR_LABEL = "Skriver svar…";

const ROUTE_SET = new Set<string>(JEV_ROUTES);

export function parseJevRoute(value: unknown): JevRoute | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ROUTE_SET.has(normalized) ? (normalized as JevRoute) : null;
}

export function readJevRouteHeader(
  headers: { get(name: string): string | null } | null | undefined,
): JevRoute | null {
  if (!headers) return null;
  // Fetch `Headers.get` is case-insensitive; the second lookup covers a
  // plain map that stored the header already lowercased.
  return parseJevRoute(headers.get(JEV_ROUTE_HEADER) ?? headers.get(JEV_ROUTE_HEADER.toLowerCase()));
}

export function readJevRouteDataPart(part: unknown): JevRoute | null {
  if (!part || typeof part !== "object") return null;
  const candidate = part as { type?: unknown; data?: unknown };
  if (candidate.type !== JEV_ROUTE_DATA_TYPE) return null;
  const data = candidate.data;
  if (typeof data === "string") return parseJevRoute(data);
  if (data && typeof data === "object" && "route" in data) {
    return parseJevRoute((data as { route?: unknown }).route);
  }
  return null;
}

export type WaitingMessage = {
  role: string;
  parts?: ReadonlyArray<{
    type: string;
    text?: string;
    data?: unknown;
  }>;
};

export function messageHasVisibleText(message: WaitingMessage | undefined): boolean {
  if (!message?.parts) return false;
  for (const part of message.parts) {
    if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) {
      return true;
    }
  }
  return false;
}

/** True from submit until the first non-empty assistant text, or until the stream leaves submitted/streaming. */
export function isWaitingForAssistantText(status: string, messages: readonly WaitingMessage[]): boolean {
  if (status !== "submitted" && status !== "streaming") return false;
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && messageHasVisibleText(last)) return false;
  return true;
}

const SILENT_PART_TYPES = new Set(["text", "step-start", JEV_ROUTE_DATA_TYPE]);

/**
 * Assistant shell with no user-visible content yet (empty text, step marker,
 * or the route data part). Safe to replace with the waiting row so we don't
 * render a blank bubble next to «Søker …».
 */
export function isSilentAssistantPlaceholder(message: WaitingMessage | undefined): boolean {
  if (!message || message.role !== "assistant") return false;
  if (messageHasVisibleText(message)) return false;
  for (const part of message.parts ?? []) {
    if (!SILENT_PART_TYPES.has(part.type)) return false;
  }
  return true;
}

export function routeFromParts(parts: WaitingMessage["parts"]): JevRoute | null {
  if (!parts) return null;
  let found: JevRoute | null = null;
  for (const part of parts) {
    const route = readJevRouteDataPart(part);
    if (route) found = route;
  }
  return found;
}

/** Header / onData wins. Parts are only a fallback while the signal is still unknown. */
export function resolveTurnRoute(signaled: JevRoute | null, partsRoute: JevRoute | null): JevRoute | null {
  return signaled ?? partsRoute;
}

export function searchingStatusLabel(input?: {
  parentHost?: string | null;
  override?: string | null;
}): string {
  const custom = input?.override?.trim();
  if (custom) return custom;
  const host = (input?.parentHost ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
  if (host === "nettsmed.no") return SEARCHING_ON_SITE_LABEL;
  return SEARCHING_LABEL;
}

export type TranscriptWait =
  | { show: false }
  | { show: true; kind: "dots"; srLabel: typeof TYPING_SR_LABEL }
  | { show: true; kind: "searching"; label: string };

export function transcriptWait(input: {
  status: string;
  messages: readonly WaitingMessage[];
  signaledRoute: JevRoute | null;
  parentHost?: string | null;
  searchingLabel?: string | null;
}): TranscriptWait {
  if (!isWaitingForAssistantText(input.status, input.messages)) return { show: false };
  const last = input.messages[input.messages.length - 1];
  const partsRoute = last?.role === "assistant" ? routeFromParts(last.parts) : null;
  const route = resolveTurnRoute(input.signaledRoute, partsRoute);
  // Only semantic_search is a search. prompt_only, ask_clarify, off,
  // error_fallback, and unknown stay on the existing typing dots.
  if (route === "semantic_search") {
    return {
      show: true,
      kind: "searching",
      label: searchingStatusLabel({
        parentHost: input.parentHost,
        override: input.searchingLabel,
      }),
    };
  }
  return { show: true, kind: "dots", srLabel: TYPING_SR_LABEL };
}

/**
 * The waiting row (dots or «Søker …») shares the transcript scrollport.
 * Hide it once the assistant bubble itself has something to show (text is
 * already excluded by `transcriptWait`; tool/reasoning parts count too) so
 * we don't stack a second avatar under a real bubble.
 */
export function waitingRowVisible(messages: readonly WaitingMessage[], wait: TranscriptWait): boolean {
  if (!wait.show) return false;
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && !isSilentAssistantPlaceholder(last)) return false;
  return true;
}
