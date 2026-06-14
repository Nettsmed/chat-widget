# Changelog

All notable changes to `@nettsmed/chat-widget`. Format: Keep a Changelog + SemVer.

## [Unreleased]

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
