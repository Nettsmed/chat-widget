import type { ChatTurnUsage } from "./types";

export type PostHogConfig = {
  apiKey: string;
  /** Default https://eu.i.posthog.com */
  host?: string;
  /** Sent as the `tenant` property so cost can be grouped per tenant. */
  tenant?: string;
  /**
   * Opt-in. When true the event also carries `$ai_input` (the user's latest message) and
   * `$ai_output_choices` (the final assistant text), PII-masked by `maskPii` and cut to 4000 chars.
   * Default false: no content leaves the server.
   */
  captureContent?: boolean;
};

export type GenerationEvent = {
  sessionId: string;
  model: string;
  provider: string;
  usage: ChatTurnUsage;
  latencyMs: number;
  /** Latest user message text. Only sent when `cfg.captureContent` is true. */
  inputText?: string;
  /** Final assistant text. Only sent when `cfg.captureContent` is true. */
  outputText?: string;
};

const DEFAULT_HOST = "https://eu.i.posthog.com";
const MAX_CONTENT_CHARS = 4000;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// International: +<digits> with optional spaces/dashes, and the 0047 prefix form.
const INTL_PHONE_RE = /(?<![\w+])\+\d(?:[ -]?\d){6,14}(?!\d)/g;
const NO_00_PHONE_RE = /(?<!\d)0047[ -]?\d(?:[ -]?\d){7}(?!\d)/g;
// 11+ digits, spaces/dashes allowed: card and account numbers.
const LONG_NUMBER_RE = /(?<!\d)\d(?:[ -]?\d){10,}(?!\d)/g;
// Org number: 9 digits, optionally grouped 3-3-3.
const ORG_NR_RE = /(?<!\d)\d{3}(?: \d{3} \d{3}|\d{6})(?!\d)/g;
// Norwegian 8-digit phone: 12345678, 123 45 678 or 12 34 56 78. Plain "1 790" or "4 799" never match.
const NO_PHONE_RE = /(?<!\d)(?:\d{8}|\d{3} \d{2} \d{3}|\d{2} \d{2} \d{2} \d{2})(?!\d)/g;

/** Mask emails, phone numbers, org numbers and long digit runs. Prices and years are left alone. */
export function maskPii(text: string): string {
  return text
    .replace(EMAIL_RE, "[e-post]")
    .replace(INTL_PHONE_RE, "[telefon]")
    .replace(NO_00_PHONE_RE, "[telefon]")
    .replace(LONG_NUMBER_RE, "[nummer]")
    .replace(ORG_NR_RE, "[org.nr]")
    .replace(NO_PHONE_RE, "[telefon]");
}

function contentField(text: string): string {
  return maskPii(text).slice(0, MAX_CONTENT_CHARS);
}

/**
 * Fire-and-forget `$ai_generation` event. Carries counts and ids only, unless `cfg.captureContent` is true (masked content).
 * Never throws and is never awaited by the caller; failures go to `onError`.
 */
export function sendGenerationEvent(
  cfg: PostHogConfig,
  ev: GenerationEvent,
  onError?: (err: unknown) => void,
): void {
  try {
    const url = `${(cfg.host ?? DEFAULT_HOST).replace(/\/+$/, "")}/i/v0/e/`;
    const body = JSON.stringify({
      api_key: cfg.apiKey,
      event: "$ai_generation",
      distinct_id: ev.sessionId,
      properties: {
        $ai_model: ev.model,
        $ai_provider: ev.provider,
        $ai_input_tokens: ev.usage.inputTokens ?? 0,
        $ai_output_tokens: ev.usage.outputTokens ?? 0,
        $ai_trace_id: ev.sessionId,
        $ai_latency: ev.latencyMs / 1000,
        ...(cfg.captureContent && ev.inputText
          ? { $ai_input: [{ role: "user", content: contentField(ev.inputText) }] }
          : {}),
        ...(cfg.captureContent && ev.outputText
          ? { $ai_output_choices: [{ role: "assistant", content: contentField(ev.outputText) }] }
          : {}),
        ...(cfg.tenant ? { tenant: cfg.tenant } : {}),
        $process_person_profile: false,
        $geoip_disable: true,
      },
    });
    const p = fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    void Promise.resolve(p)
      .then((res) => {
        if (res && res.ok === false) onError?.(new Error(`posthog ${res.status}`));
      })
      .catch((err) => onError?.(err));
  } catch (err) {
    onError?.(err);
  }
}
