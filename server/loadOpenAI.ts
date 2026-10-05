import { createRequire } from "node:module";
import type { LanguageModel } from "ai";

const require = createRequire(import.meta.url);

export type OpenAIProviderModule = {
  openai: (id: string) => LanguageModel;
  createOpenAI: (opts: { apiKey: string }) => (id: string) => LanguageModel;
};

/** Isolated so tests can stub the optional peer without installing it. */
export function loadOpenAI(): OpenAIProviderModule {
  return require("@ai-sdk/openai") as OpenAIProviderModule;
}
