import { describe, it, expect, vi, beforeEach } from "vitest";

const { createOpenAI, defaultOpenAI } = vi.hoisted(() => ({
  createOpenAI: vi.fn(() => (id: string) => ({ modelId: id, byok: true, vendor: "openai" })),
  defaultOpenAI: vi.fn((id: string) => ({ modelId: id, byok: false, vendor: "openai" })),
}));

vi.mock("@ai-sdk/anthropic", () => {
  const createAnthropic = vi.fn(() => (id: string) => ({ modelId: id, byok: true, vendor: "anthropic" }));
  const defaultProvider = vi.fn((id: string) => ({ modelId: id, byok: false, vendor: "anthropic" }));
  return {
    createAnthropic,
    anthropic: defaultProvider,
  };
});

vi.mock("../server/loadOpenAI", () => ({
  loadOpenAI: () => ({ openai: defaultOpenAI, createOpenAI }),
}));

import { resolveAnthropicModel, resolveChatModel } from "../server/model";
import { createAnthropic, anthropic as defaultAnthropic } from "@ai-sdk/anthropic";

describe("resolveAnthropicModel", () => {
  beforeEach(() => {
    (createAnthropic as any).mockClear();
    (defaultAnthropic as any).mockClear();
  });

  it("uses the default env provider when no key is given", () => {
    const m = resolveAnthropicModel("claude-haiku-4-5") as unknown as { byok: boolean };
    expect(defaultAnthropic).toHaveBeenCalledWith("claude-haiku-4-5");
    expect(createAnthropic).not.toHaveBeenCalled();
    expect(m.byok).toBe(false);
  });

  it("builds a per-tenant provider when an apiKey is given (BYOK)", () => {
    const m = resolveAnthropicModel("claude-haiku-4-5", "sk-ant-tenant") as unknown as { byok: boolean };
    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-tenant" });
    expect(m.byok).toBe(true);
  });
});

describe("resolveChatModel", () => {
  beforeEach(() => {
    (createAnthropic as any).mockClear();
    (defaultAnthropic as any).mockClear();
    createOpenAI.mockClear();
    defaultOpenAI.mockClear();
  });

  it("defaults to anthropic", () => {
    const m = resolveChatModel("claude-haiku-4-5") as unknown as { vendor: string };
    expect(defaultAnthropic).toHaveBeenCalledWith("claude-haiku-4-5");
    expect(defaultOpenAI).not.toHaveBeenCalled();
    expect(m.vendor).toBe("anthropic");
  });

  it("resolves openai with the optional peer (BYOK)", () => {
    const m = resolveChatModel("gpt-4.1-mini", "openai", "sk-openai") as unknown as {
      vendor: string;
      byok: boolean;
    };
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-openai" });
    expect(m.vendor).toBe("openai");
    expect(m.byok).toBe(true);
  });

  it("throws a clear error when the optional openai peer cannot be loaded", async () => {
    vi.resetModules();
    vi.doMock("../server/loadOpenAI", () => ({
      loadOpenAI: () => {
        throw new Error("Cannot find module '@ai-sdk/openai'");
      },
    }));
    const { resolveChatModel: resolve } = await import("../server/model");
    expect(() => resolve("gpt-4.1-mini", "openai")).toThrow(/@ai-sdk\/openai/);
  });
});
