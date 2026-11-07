import { createRequire } from "node:module";
import type { LanguageModel } from "ai";

const require = createRequire(import.meta.url);

export type OpenAIProviderModule = {
  openai: (id: string) => LanguageModel;
  createOpenAI: (opts: { apiKey: string }) => (id: string) => LanguageModel;
};

/** Isolated so tests can stub the optional peer without installing it. */
export function loadOpenAI(): OpenAIProviderModule {
  // Optional peer: a literal `require("@ai-sdk/openai")` is resolved by the consumer's bundler at build time (Turbopack
  // and webpack fail the build when the package is not installed), so the bundler is told to leave this call alone.
  return require(/* turbopackIgnore: true */ /* webpackIgnore: true */ "@ai-sdk/openai") as OpenAIProviderModule;
}
