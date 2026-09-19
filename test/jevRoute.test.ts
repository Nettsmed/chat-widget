import { describe, expect, it } from "vitest";
import {
  JEV_ROUTE_DATA_TYPE,
  JEV_ROUTE_HEADER,
  SEARCHING_LABEL,
  SEARCHING_ON_SITE_LABEL,
  TYPING_SR_LABEL,
  isSilentAssistantPlaceholder,
  parseJevRoute,
  readJevRouteDataPart,
  readJevRouteHeader,
  resolveTurnRoute,
  searchingStatusLabel,
  transcriptWait,
  waitingRowVisible,
  type JevRoute,
  type WaitingMessage,
} from "../src/jevRoute";

const user = (id = "u1"): WaitingMessage => ({ role: "user", parts: [{ type: "text", text: "Vipps?" }] });

function assistant(parts: WaitingMessage["parts"]): WaitingMessage {
  return { role: "assistant", parts };
}

describe("parseJevRoute", () => {
  it("accepts the five backend routes, ignoring case and surrounding space", () => {
    expect(parseJevRoute("semantic_search")).toBe("semantic_search");
    expect(parseJevRoute("  PROMPT_ONLY ")).toBe("prompt_only");
    expect(parseJevRoute("ask_clarify")).toBe("ask_clarify");
    expect(parseJevRoute("off")).toBe("off");
    expect(parseJevRoute("error_fallback")).toBe("error_fallback");
  });

  it("rejects unknown, empty, and non-strings", () => {
    expect(parseJevRoute("search")).toBeNull();
    expect(parseJevRoute("")).toBeNull();
    expect(parseJevRoute(" semantic_search extra")).toBeNull();
    expect(parseJevRoute(null)).toBeNull();
    expect(parseJevRoute(undefined)).toBeNull();
    expect(parseJevRoute(1)).toBeNull();
  });
});

describe("readJevRouteHeader", () => {
  it("reads X-Jev-Route", () => {
    const headers = new Headers({ [JEV_ROUTE_HEADER]: "semantic_search" });
    expect(readJevRouteHeader(headers)).toBe("semantic_search");
  });

  it("reads a lowercased map and ignores a missing or invalid header", () => {
    expect(readJevRouteHeader({ get: (name) => (name === "x-jev-route" ? "ask_clarify" : null) })).toBe(
      "ask_clarify",
    );
    expect(readJevRouteHeader(new Headers())).toBeNull();
    expect(readJevRouteHeader(new Headers({ [JEV_ROUTE_HEADER]: "nope" }))).toBeNull();
    expect(readJevRouteHeader(null)).toBeNull();
  });
});

describe("readJevRouteDataPart", () => {
  it("accepts the documented object and string payloads", () => {
    expect(readJevRouteDataPart({ type: JEV_ROUTE_DATA_TYPE, data: { route: "semantic_search" } })).toBe(
      "semantic_search",
    );
    expect(readJevRouteDataPart({ type: JEV_ROUTE_DATA_TYPE, data: "prompt_only" })).toBe("prompt_only");
  });

  it("ignores other parts and bad payloads", () => {
    expect(readJevRouteDataPart({ type: "text", text: "hei" })).toBeNull();
    expect(readJevRouteDataPart({ type: "data-weather", data: { route: "semantic_search" } })).toBeNull();
    expect(readJevRouteDataPart({ type: JEV_ROUTE_DATA_TYPE, data: { route: "maybe" } })).toBeNull();
    expect(readJevRouteDataPart(null)).toBeNull();
  });
});

describe("searchingStatusLabel", () => {
  it("uses the site line on nettsmed.no and the generic line elsewhere", () => {
    expect(searchingStatusLabel({ parentHost: "nettsmed.no" })).toBe(SEARCHING_ON_SITE_LABEL);
    expect(searchingStatusLabel({ parentHost: "www.nettsmed.no" })).toBe(SEARCHING_ON_SITE_LABEL);
    expect(searchingStatusLabel({ parentHost: "Nettsmed.no:443" })).toBe(SEARCHING_ON_SITE_LABEL);
    expect(searchingStatusLabel({ parentHost: "hjelp.nettsmed.no" })).toBe(SEARCHING_LABEL);
    expect(searchingStatusLabel({ parentHost: "" })).toBe(SEARCHING_LABEL);
    expect(searchingStatusLabel()).toBe(SEARCHING_LABEL);
  });

  it("lets config override either default", () => {
    expect(searchingStatusLabel({ parentHost: "example.com", override: "Søker i arkivet …" })).toBe(
      "Søker i arkivet …",
    );
    expect(searchingStatusLabel({ parentHost: "nettsmed.no", override: "  Søker …  " })).toBe("Søker …");
  });
});

describe("transcriptWait", () => {
  const base = {
    messages: [user()],
    signaledRoute: null as JevRoute | null,
    parentHost: "nettsmed.no",
  };

  it("keeps typing dots while the route is unknown", () => {
    expect(transcriptWait({ ...base, status: "submitted" })).toEqual({
      show: true,
      kind: "dots",
      srLabel: TYPING_SR_LABEL,
    });
    expect(transcriptWait({ ...base, status: "streaming" }).kind).toBe("dots");
  });

  it.each(["prompt_only", "ask_clarify", "off", "error_fallback"] as const)(
    "does not pretend to search for %s",
    (route) => {
      const wait = transcriptWait({ ...base, status: "streaming", signaledRoute: route });
      expect(wait).toEqual({ show: true, kind: "dots", srLabel: TYPING_SR_LABEL });
    },
  );

  it("shows the site search line only for semantic_search", () => {
    expect(transcriptWait({ ...base, status: "submitted", signaledRoute: "semantic_search" })).toEqual({
      show: true,
      kind: "searching",
      label: SEARCHING_ON_SITE_LABEL,
    });
    expect(
      transcriptWait({
        ...base,
        status: "streaming",
        parentHost: "preview.example",
        signaledRoute: "semantic_search",
      }).label,
    ).toBe(SEARCHING_LABEL);
  });

  it("clears when assistant text arrives or the stream finishes", () => {
    const withText = [
      user(),
      assistant([
        { type: "text", text: " " },
        { type: "text", text: "Vipps støttes." },
      ]),
    ];
    expect(transcriptWait({ ...base, status: "streaming", messages: withText, signaledRoute: "semantic_search" })).toEqual({
      show: false,
    });
    expect(transcriptWait({ ...base, status: "ready", signaledRoute: "semantic_search" })).toEqual({ show: false });
    expect(transcriptWait({ ...base, status: "error", signaledRoute: "semantic_search" })).toEqual({ show: false });
  });

  it("stays up for whitespace-only assistant text", () => {
    const blank = [user(), assistant([{ type: "text", text: " \n " }])];
    expect(transcriptWait({ ...base, status: "streaming", messages: blank, signaledRoute: "semantic_search" }).kind).toBe(
      "searching",
    );
  });

  it("reads a persisted data part when no header signal has arrived", () => {
    const messages = [
      user(),
      assistant([
        { type: "step-start" },
        { type: JEV_ROUTE_DATA_TYPE, data: { route: "semantic_search" } },
      ]),
    ];
    expect(transcriptWait({ ...base, status: "streaming", messages, signaledRoute: null })).toMatchObject({
      show: true,
      kind: "searching",
    });
  });

  it("does not let a parts fallback override a known non-search header", () => {
    const messages = [
      user(),
      assistant([{ type: JEV_ROUTE_DATA_TYPE, data: { route: "semantic_search" } }]),
    ];
    expect(resolveTurnRoute("prompt_only", "semantic_search")).toBe("prompt_only");
    expect(transcriptWait({ ...base, status: "streaming", messages, signaledRoute: "prompt_only" }).kind).toBe("dots");
  });

  it("honours searchingLabel", () => {
    expect(
      transcriptWait({
        ...base,
        status: "submitted",
        signaledRoute: "semantic_search",
        searchingLabel: "Søker i dokumentene …",
      }).label,
    ).toBe("Søker i dokumentene …");
  });
});

describe("waiting row vs placeholder bubble", () => {
  it("replaces a silent assistant shell so the row is the only status", () => {
    const messages = [user(), assistant([{ type: "step-start" }, { type: "text", text: "" }])];
    const wait = transcriptWait({
      status: "streaming",
      messages,
      signaledRoute: "semantic_search",
      parentHost: "nettsmed.no",
    });
    expect(isSilentAssistantPlaceholder(messages[1])).toBe(true);
    expect(waitingRowVisible(messages, wait)).toBe(true);
  });

  it("does not stack a row under a bubble that already has tool content", () => {
    const messages = [user(), assistant([{ type: "tool-lead", text: "" }])];
    const wait = transcriptWait({
      status: "streaming",
      messages,
      signaledRoute: "semantic_search",
      parentHost: "",
    });
    expect(wait.show).toBe(true);
    expect(waitingRowVisible(messages, wait)).toBe(false);
    expect(isSilentAssistantPlaceholder(messages[0])).toBe(false);
  });

  it("shows the row while the last message is still the user", () => {
    const messages = [user()];
    const wait = transcriptWait({ status: "submitted", messages, signaledRoute: null });
    expect(waitingRowVisible(messages, wait)).toBe(true);
  });
});
