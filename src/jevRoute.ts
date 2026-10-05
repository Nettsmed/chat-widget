/**
 * Live «Søker …» while the Spør KI backend routes via Jev.
 *
 * Locked client contract (nettsmed-site #34): `DefaultChatTransport` does not
 * pass Response headers into `useChat`. On every 200 chat stream the site
 * prepends a transient UI-message data part. `useChat` `onData` is the only
 * place that part is visible (transient parts are not added to `message.parts`).
 *
 *   type: "data-jev-route"   // AI SDK data-part name
 *   data: {
 *     route: "prompt_only" | "semantic_search" | "ask_clarify" | "off" | "error_fallback"
 *     gated?: 0 | 1 | boolean   // optional, not shown
 *     latencyMs?: number        // optional, not shown (`latency` accepted too)
 *   }
 *
 * Unknown / missing route keeps the typing dots. Only `semantic_search` is a search.
 */

export const JEV_ROUTES = [
  "prompt_only",
  "semantic_search",
  "ask_clarify",
  "off",
  "error_fallback",
] as const;

export type JevRoute = (typeof JEV_ROUTES)[number];

/**
 * AI SDK data-part type (`data-${name}`). `onData` parts use this as `type`.
 * Also accepted as a `name` if a producer sets that field separately.
 */
export const JEV_ROUTE_DATA_TYPE = "data-jev-route";

/** Optional fields on the part. The widget only reads `route`. */
export type JevRoutePartData = {
  route: JevRoute;
  /** Confidence gate fired. 0 | 1 or boolean. Not rendered. */
  gated?: 0 | 1 | boolean;
  /** Router latency. Not rendered. `latency` is accepted as an alias. */
  latencyMs?: number;
  latency?: number;
};

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

function isJevRoutePart(part: { type?: unknown; name?: unknown }): boolean {
  return part.type === JEV_ROUTE_DATA_TYPE || part.name === JEV_ROUTE_DATA_TYPE;
}

/**
 * Route from a `useChat` `onData` part. Ignores optional `gated` / `latencyMs`.
 * Returns null for any other part, so the caller must not guess a search.
 */
export function readJevRouteDataPart(part: unknown): JevRoute | null {
  if (!part || typeof part !== "object") return null;
  const candidate = part as { type?: unknown; name?: unknown; data?: unknown };
  if (!isJevRoutePart(candidate)) return null;
  const data = candidate.data;
  if (typeof data === "string") return parseJevRoute(data);
  if (!data || typeof data !== "object") return null;
  const record = data as { route?: unknown; choice?: unknown };
  return parseJevRoute(record.route ?? record.choice);
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

/** onData wins. Message parts are only a fallback if the part was not transient. */
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
