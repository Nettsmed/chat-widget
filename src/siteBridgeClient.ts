"use client";

/**
 * Iframe-side client for the site-bridge. Wraps window.parent.postMessage with
 * correlation ids + per-request promises + timeout. Sends only logical field
 * keys; the parent resolves them to selectors. Validates that replies come from
 * the configured parent origin.
 */

const NS = "nettsmed-bridge";
const V = 1;

export type BridgeResult = { ok: boolean; applied?: string[]; error?: string };

export type BridgeClient = {
  request: (type: "prefill" | "scroll", payload: unknown, timeoutMs?: number) => Promise<BridgeResult>;
  dispose: () => void;
};

export function createBridgeClient(parentOrigin: string): BridgeClient {
  let counter = 0;
  const pending = new Map<string, { resolve: (r: BridgeResult) => void; timer: ReturnType<typeof setTimeout> }>();

  function onMessage(ev: MessageEvent) {
    // Origin + source guard: replies must come from the actual parent window.
    if (!parentOrigin || ev.origin !== parentOrigin) return;
    if (typeof window !== "undefined" && ev.source !== window.parent) return;
    const data = ev.data as { ns?: string; v?: number; id?: string; type?: string; payload?: BridgeResult };
    if (!data || data.ns !== NS || data.v !== V || !data.id || !data.type) return;
    if (!data.type.endsWith(".result")) return;
    const entry = pending.get(data.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(data.id);
    entry.resolve(data.payload ?? { ok: false, error: "empty" });
  }

  if (typeof window !== "undefined") window.addEventListener("message", onMessage);

  return {
    request(type, payload, timeoutMs = 8000) {
      if (typeof window === "undefined" || !parentOrigin) {
        return Promise.resolve({ ok: false, error: "no_parent" });
      }
      counter += 1;
      const id = `${type}-${counter}-${Date.now()}`;
      return new Promise<BridgeResult>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: "timeout" });
        }, timeoutMs);
        pending.set(id, { resolve, timer });
        try {
          window.parent.postMessage({ ns: NS, v: V, id, type, payload }, parentOrigin);
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          resolve({ ok: false, error: "post_failed" });
        }
      });
    },
    dispose() {
      if (typeof window !== "undefined") window.removeEventListener("message", onMessage);
      pending.forEach((e) => clearTimeout(e.timer));
      pending.clear();
    },
  };
}
