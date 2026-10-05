import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { loadOpenAI } from "./loadOpenAI";
import type { ChatProvider } from "./types";

/**
 * Resolve the Anthropic model. With `apiKey` (BYOK / per-tenant billing) a
 * dedicated provider is built so usage bills to that key; without it the
 * env-default (`ANTHROPIC_API_KEY`) is used.
 */
export function resolveAnthropicModel(modelId: string, apiKey?: string): LanguageModel {
  const provider = apiKey ? createAnthropic({ apiKey }) : anthropic;
  return provider(modelId);
}

function resolveOpenAIModel(modelId: string, apiKey?: string): LanguageModel {
  let mod;
  try {
    mod = loadOpenAI();
  } catch {
    throw new Error(
      'Chat provider "openai" requires the optional peer dependency @ai-sdk/openai (^3).',
    );
  }
  const provider = apiKey ? mod.createOpenAI({ apiKey }) : mod.openai;
  return provider(modelId);
}

/**
 * Resolve a chat model for `provider` (default `"anthropic"`).
 * OpenAI needs the optional peer `@ai-sdk/openai`.
 */
export function resolveChatModel(
  modelId: string,
  provider: ChatProvider = "anthropic",
  apiKey?: string,
): LanguageModel {
  if (provider === "openai") return resolveOpenAIModel(modelId, apiKey);
  return resolveAnthropicModel(modelId, apiKey);
}
