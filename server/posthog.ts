import type { ChatTurnUsage } from "./types";

export type PostHogConfig = {
  apiKey: string;
  /** Default https://eu.i.posthog.com */
  host?: string;
  /** Sent as the `tenant` property so cost can be grouped per tenant. */
  tenant?: string;
};

export type GenerationEvent = {
  sessionId: string;
  model: string;
  provider: string;
  usage: ChatTurnUsage;
  latencyMs: number;
};

const DEFAULT_HOST = "https://eu.i.posthog.com";

/**
 * Fire-and-forget `$ai_generation` event. Carries counts and ids only, never message content.
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
