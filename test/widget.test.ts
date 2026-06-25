// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(process.cwd(), "public/widget.js"), "utf8");

// Load the widget IIFE with a stubbed `document.currentScript` carrying the
// given data-* attributes. In jsdom readyState is "complete", so onReady runs
// synchronously and the launcher + iframe are appended during eval.
function loadWidget(dataset: Record<string, string>) {
  (window as unknown as { __nettsmedChatbotLoaded?: boolean }).__nettsmedChatbotLoaded = undefined;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  Object.defineProperty(document, "currentScript", {
    value: { dataset, src: "https://hjelp.nettsmed.no/widget.js" },
    configurable: true,
  });
  // eslint-disable-next-line no-eval
  (0, eval)(SRC);
}

function iframeSrc(): string {
  const f = document.querySelector(".nettsmed-chat-wrap iframe") as HTMLIFrameElement | null;
  return f?.src ?? "";
}

describe("widget.js page-context passthrough", () => {
  it("appends screen and stack to the embed URL when provided", () => {
    loadWidget({ base: "https://hjelp.nettsmed.no", screen: "edit-product", stack: "woocommerce,wordpress" });
    const src = iframeSrc();
    expect(src).toContain("/embed?ctx=");
    expect(src).toContain("&screen=edit-product");
    expect(src).toContain("&stack=woocommerce%2Cwordpress");
  });

  it("omits screen and stack when not provided (backward compatible)", () => {
    loadWidget({ base: "https://hjelp.nettsmed.no" });
    const src = iframeSrc();
    expect(src).toContain("/embed?ctx=");
    expect(src).not.toContain("&screen=");
    expect(src).not.toContain("&stack=");
  });

  it("appends minside and email when provided", () => {
    loadWidget({ base: "https://hjelp.nettsmed.no", minside: "1", email: "sf@nettsmed.no" });
    const src = iframeSrc();
    expect(src).toContain("&minside=1");
    expect(src).toContain("&email=sf%40nettsmed.no");
  });

  it("omits minside and email when not provided (backward compatible)", () => {
    loadWidget({ base: "https://hjelp.nettsmed.no" });
    const src = iframeSrc();
    expect(src).not.toContain("&minside=");
    expect(src).not.toContain("&email=");
  });
});
