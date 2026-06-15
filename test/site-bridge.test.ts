// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load the parent-engine IIFE once; it attaches a single message listener that
// reads window.__SITE_BRIDGE_CONFIG__ live, so per-test config/form is enough.
const src = readFileSync(resolve(process.cwd(), "public/site-bridge.js"), "utf8");
// eslint-disable-next-line no-eval
(0, eval)(src);

const IFRAME_ORIGIN = "https://app.test";

function setForm() {
  document.body.innerHTML = `
    <form id="kontaktskjema">
      <input name="navn" />
      <input name="e-post" />
      <textarea name="melding"></textarea>
      <input name="user_pass" type="hidden" />
    </form>`;
}

function config() {
  (window as unknown as { __SITE_BRIDGE_CONFIG__: unknown }).__SITE_BRIDGE_CONFIG__ = {
    iframeOrigin: IFRAME_ORIGIN,
    capabilities: { prefill: true, scroll: true },
    forms: {
      contact: {
        fields: {
          navn: "input[name='navn']",
          epost: "input[name='e-post']",
          melding: "textarea[name='melding']",
        },
        scrollTo: "#kontaktskjema",
      },
    },
  };
}

function send(origin: string, payload: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin,
      source: window,
      data: { ns: "nettsmed-bridge", v: 1, id: "t", type: "prefill", payload },
    }),
  );
}

const val = (sel: string) => (document.querySelector(sel) as HTMLInputElement)?.value;

describe("site-bridge parent engine", () => {
  beforeEach(() => {
    setForm();
    config();
  });

  it("fills mapped logical fields on a same-origin prefill", () => {
    send(IFRAME_ORIGIN, { form: "contact", fields: { navn: "Kari", epost: "k@x.no", melding: "hei" } });
    expect(val("input[name='navn']")).toBe("Kari");
    expect(val("input[name='e-post']")).toBe("k@x.no");
    expect(val("textarea[name='melding']")).toBe("hei");
  });

  it("REJECTS a message from the wrong origin (nothing written)", () => {
    send("https://evil.test", { form: "contact", fields: { navn: "HACKED" } });
    expect(val("input[name='navn']")).toBe("");
  });

  it("ignores keys not on the config allowlist (hidden/auth fields unreachable)", () => {
    send(IFRAME_ORIGIN, {
      form: "contact",
      fields: { navn: "Kari", user_pass: "secret" },
    });
    expect(val("input[name='navn']")).toBe("Kari");
    expect(val("input[name='user_pass']")).toBe(""); // not in the field map
  });

  it("never submits — only sets .value (no form submission)", () => {
    let submitted = false;
    document.querySelector("form")!.addEventListener("submit", () => (submitted = true));
    send(IFRAME_ORIGIN, { form: "contact", fields: { navn: "Kari" } });
    expect(submitted).toBe(false);
    expect(val("input[name='navn']")).toBe("Kari");
  });

  it("ignores an unknown form key", () => {
    send(IFRAME_ORIGIN, { form: "does-not-exist", fields: { navn: "Kari" } });
    expect(val("input[name='navn']")).toBe("");
  });
});
