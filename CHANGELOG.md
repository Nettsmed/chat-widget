# Changelog

All notable changes to `@nettsmed/chat-widget`. Format: Keep a Changelog + SemVer.

## [Unreleased]

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
