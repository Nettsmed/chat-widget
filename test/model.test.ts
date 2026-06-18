import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ai-sdk/anthropic", () => {
  const createAnthropic = vi.fn(() => (id: string) => ({ modelId: id, byok: true }));
  const defaultProvider = vi.fn((id: string) => ({ modelId: id, byok: false }));
  return {
    createAnthropic,
    anthropic: defaultProvider,
  };
});

import { resolveAnthropicModel } from "../server/model";
import { createAnthropic, anthropic as defaultProvider } from "@ai-sdk/anthropic";

describe("resolveAnthropicModel", () => {
  beforeEach(() => {
    (createAnthropic as any).mockClear();
    (defaultProvider as any).mockClear();
  });

  it("uses the default env provider when no key is given", () => {
    const m = resolveAnthropicModel("claude-haiku-4-5") as unknown as { byok: boolean };
    expect(defaultProvider).toHaveBeenCalledWith("claude-haiku-4-5");
    expect(createAnthropic).not.toHaveBeenCalled();
    expect(m.byok).toBe(false);
  });

  it("builds a per-tenant provider when an apiKey is given (BYOK)", () => {
    const m = resolveAnthropicModel("claude-haiku-4-5", "sk-ant-tenant") as unknown as { byok: boolean };
    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-tenant" });
    expect(m.byok).toBe(true);
  });
});
