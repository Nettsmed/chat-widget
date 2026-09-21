# Changelog

All notable changes to `@nettsmed/chat-widget`. Format: Keep a Changelog + SemVer.

## [Unreleased]

## [0.7.5] - 2026-09-21

### Added
- **Visible comment when the visitor sends the conversation.** On the «Send samtalen til oss» path the transcript shows a form: e-post if we do not already have one, and a short **Kommentar** (required). Submitting it continues the chat so `capture_lead` runs with `comment`, `visitor_message`, and `explicit_send: true` — the same fields Mailgun reads as «Kommentar fra besøker». An empty comment cannot be sent on that path.
- The form shows in two cases: the lead tool pauses in AI SDK `approval-requested` (human-in-the-loop; the visitor’s text is written onto that tool call before it is approved), or the model only asked in prose (no tool part yet). The prose path still posts an approved `tool-${leadToolName}` part so the server executes `capture_lead` instead of waiting for the model to ask again.
- Optional `ChatWidgetConfig.leadForm` overrides the Norwegian copy. A successful lead still renders the tool’s own confirmation; a refused explicit send shows the form again.

## [0.7.4] - 2026-09-19

### Added
- **«Søker …» while Jev routes to semantic search.** The transcript shows a live status for the in-flight turn when the chat Response carries `X-Jev-Route: semantic_search` — «Søker på nettsmed.no …» if the parent page host is nettsmed.no, otherwise «Søker …». Optional `ChatWidgetConfig.searchingLabel` overrides either line. The status sits in the same scroll container as the typing dots and clears when assistant text arrives or the stream finishes.
- `prompt_only`, `ask_clarify`, `off`, `error_fallback`, and an unknown route keep the existing typing dots («Skriver svar…»). The widget does not guess a search. `X-Jev-Route` is read from the Response as soon as `fetch` resolves (before the body is consumed). If that header is missing, a `data-jev-route` stream part (`{ route }` or a route string) is accepted instead.

## [0.7.3] - 2026-09-19

### Fixed
- **Streaming follow no longer dies on the first pin.** Instant `pinToBottom` cleared its ignore flag before Safari and mobile Chrome delivered the `scroll` event from `scrollTop = scrollHeight`. That event saw a mid-update box and set `stickToBottom` false, so `followIfStuck` no-oped for the rest of the stream (`src/scrollStickiness.ts`, wired in `ChatWidget`). Programmatic scroll events cannot clear stickiness: the ignore window stays up for two frames (then re-pins if the scrollport is not settled, with `scrollend` and a short cap), and a scroll with no user gesture is ignored even if that window already closed.
- A bare `pointerdown` on the transcript no longer pauses follow. Only a wheel or pointer/touch movement does. A lost `pointerup` cannot leave follow paused — the gesture settles on `scrollend` or a short timeout, without treating tokens that arrived during a tap as a scroll-up.

## [0.7.2] - 2026-09-19

### Fixed
- **The transcript follows a streaming answer only while the reader is near the bottom.** `ChatWidget` used to `scrollTo({ behavior: "smooth" })` on every message/status change, which fought itself mid-stream and yanked the viewport back if you scrolled up. Following is now instant and sticky (`src/scrollStickiness.ts`, wired to `scrollRef`). Scrolling up pauses it; «Hopp til siste» or returning near the bottom resumes it. A finished stream does not scroll you if you are mid-thread.

## [0.7.1] - 2026-07-30

### Fixed
- **An Upstash outage no longer takes the chat endpoint down.** `checkRateLimit`
  awaited `rl.limit()` unguarded, so an unreachable Redis (a deleted database
  gives `getaddrinfo ENOTFOUND`) rejected the whole POST handler — every request
  became a bare 500 with an empty body and the widget went silent. Upstash
  failures now degrade to the existing in-memory limiter, which still enforces a
  limit (the "never fails open" invariant is unchanged).
- Upstash client retries lowered from the SDK default (5, exponential backoff) to
  1, so a dead endpoint fails fast instead of adding seconds to every request.
- A 60s circuit breaker trips after 2 consecutive Upstash failures, so a dead
  Redis isn't re-dialed per request. One log line per outage window, not per
  request.
- `createChatHandler` wraps the pipeline: any unexpected throw is reported via
  `onStreamError` and answered with the tenant's `errorMessage` as a normal
  assistant turn, instead of a bare 500 the user sees as no response.

## [0.7.0] - 2026-06-25

### Added
- `widget.js` "Min side" passthrough: optional `data-minside` and `data-email`
  attributes are forwarded to the embed iframe URL (`&minside=…&email=…`). Lets a
  host with the minside-SSO bridge tell the embed to surface a Min side section
  (the SSO launch is handled parent-side via postMessage — no token crosses the
  iframe). Absent attributes are a no-op (backward compatible).

## [0.6.0] - 2026-06-25

### Added
- `widget.js` page-context passthrough: optional `data-screen` and `data-stack`
  attributes are forwarded to the embed iframe URL (`&screen=…&stack=…`). Lets a
  host that knows where the user is — e.g. a WordPress plugin reporting the
  current admin screen + active stack — drive screen-aware suggestions and
  answer weighting in the embed. Absent attributes are a no-op (backward
  compatible; existing consumers unaffected).

## [0.5.0] - 2026-06-18

### Added
- `./server` is now framework-agnostic — raw serverless (non-Next) hosts can consume the chat pipeline. Inject the host scheduler with `setBackgroundRunner(after)` (Next) or leave unset (fire-and-forget fallback).
- BYOK: `ChatHandlerConfig.apiKey` routes a tenant's traffic to its own Anthropic key (per-tenant billing). Omit for Nettsmed-managed default.
- Per-tenant daily token spend cap: `ChatHandlerConfig.spendCap = { tenantKey, dailyTokens }`. Over budget → graceful `errorMessage`, no model call. Fails closed.

### Changed
- `server/turso.ts` no longer imports `next/server`; uses the injectable `runBackground`.
- `next` removed from `peerDependencies` (now only needed by the React/`.` surface, not `./server`).

## [0.4.0] - 2026-06-15

### Fixed
- **Prompt caching now actually works.** Moved the Anthropic `cacheControl`
  ephemeral breakpoint from top-level `providerOptions` (a no-op for the system
  string) onto a `role:"system"` message in `messages`. The large stable system
  prompt is now cached → ~70% input-token reduction on repeat turns.

## [0.3.0] - 2026-06-15

### Added
- Accessibility: panel is `role="dialog"` (+ `aria-modal` when floating) and closes
  on **Escape**; message log is `role="log" aria-live="polite" aria-busy`; typing
  indicator announces "Skriver svar…" (sr-only); error banner is `role="alert"`.
  Screen readers can now follow the conversation. `.cw-sr-only` util + a
  `prefers-reduced-motion` block (WCAG 2.2.2) added to `styles.css`.
- `ChatHandlerConfig.getContent` is now optional (omit when content is baked into
  the prompt); a `getContent()` failure now calls `onStreamError` instead of
  silently answering ungrounded.

### Fixed
- Prefill confirmation no longer hangs on "Fyller inn skjemaet…" when no bridge is
  present on the page — it falls back (never falsely claims the form was filled).

## [0.2.0] - 2026-06-15

### Added
- **Site-bridge**: generic, config-driven capability for the chat iframe to
  prefill a host-page form (and scroll) WITHOUT naming a selector. The iframe
  sends only logical field keys; the parent (`public/site-bridge.js`) maps keys
  to selectors from `window.__SITE_BRIDGE_CONFIG__` (allowlist), origin-validated
  both directions, prefill-only (never submits), values via `.value` + length
  clamp. New `src/siteBridgeClient.ts` (iframe client with correlation ids +
  timeout). `ChatWidgetConfig.prefillToolName` opts a tenant in: when that tool
  returns `{action:"prefill", form, fields}`, the widget drives the bridge.
- Exports: `createBridgeClient`, `BridgeClient`, `BridgeResult`.

## [0.1.1] - 2026-06-14

### Added
- Same-site link handling: links to the parent site's host now open with
  `target="_top"` (navigate the parent) so the chat stays open and the
  conversation continues on the next page; external links keep `_blank`.
  Driven by a new `parentHost` (derived from `?ctx`) passed to `MessageText`.
- `ChatHandlerConfig.onStreamError` hook so the app can report stream/response
  errors (e.g. Sentry) without the package depending on any reporter.

### Changed
- `getClientIp` now prefers platform-set `x-real-ip` / `x-vercel-forwarded-for`
  (unspoofable) over client-appendable `x-forwarded-for` for rate-limit keying.

### Added
- Initial extraction of the shared Nettsmed chat widget from Solveig (superset)
  and Nora.
- `ChatWidget`, `MessageText`, `SmartTable` (data-bar tables), config-driven via
  `ChatWidgetConfig` with `--cw-*` CSS-variable theming.
- `@nettsmed/chat-widget/server`: `createChatHandler`, `createRevalidateHandler`,
  `checkRateLimit` (fail-closed), `logMessage` (Turso, GDPR purge, optional IP),
  `resolveAccessContext` seam.
- Parameterized `widget.js` loader (data-* driven) + `styles.css` (animations +
  scrollbar) + `site-bridge.js` skeleton.
