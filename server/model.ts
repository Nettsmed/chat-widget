import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/**
 * Resolve the Anthropic model. With `apiKey` (BYOK / per-tenant billing) a
 * dedicated provider is built so usage bills to that key; without it the
 * env-default (`ANTHROPIC_API_KEY`, Nettsmed-managed) is used.
 */
export function resolveAnthropicModel(modelId: string, apiKey?: string): LanguageModel {
  const provider = apiKey ? createAnthropic({ apiKey }) : anthropic;
  return provider(modelId);
}
