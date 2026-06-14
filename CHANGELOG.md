# Changelog

All notable changes to `@nettsmed/chat-widget`. Format: Keep a Changelog + SemVer.

## [Unreleased]

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
