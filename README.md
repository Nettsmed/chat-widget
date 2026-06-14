# @nettsmed/chat-widget

Shared core for the Nettsmed AI chat-widget fleet (Solveig, Nora, …). The UI
shell, markdown/data-bar rendering, the generic API-route pipeline (rate-limit,
abuse guards, Turso logging, streaming + tool loop), the `widget.js` embed
loader and the site-bridge live here. Each customer app supplies only its
config (theme, copy), system prompt, tools/data adapter and WP plugins.

## Consume (per-customer app)

`package.json`:
```jsonc
"@nettsmed/chat-widget": "github:Nettsmed/chat-widget#v0.1.0"
```
`next.config.ts`: `transpilePackages: ["@nettsmed/chat-widget"]`

`app/globals.css` (after `@import "tailwindcss";`):
```css
@import "@nettsmed/chat-widget/styles.css";
@source "../node_modules/@nettsmed/chat-widget/src"; /* depth differs per repo */
```

```tsx
import { ChatWidget } from "@nettsmed/chat-widget";
import { config } from "@/lib/widget-config";
<ChatWidget embed config={config} />
```

```ts
import { createChatHandler } from "@nettsmed/chat-widget/server";
export const POST = createChatHandler({ model, buildSystemPrompt, getContent, getTools, errorMessage });
```

## Theming

Brand colors are `--cw-*` CSS variables set from `config.colors` on the widget
root. Class strings are identical across tenants, so Tailwind scans the package
once. Never use per-brand arbitrary hex classes in the package.

## Distribution

Private `github:` git-tag dependency. Bump `version` + tag `vX.Y.Z`; customers
adopt by bumping `#vX.Y.Z` independently (no forced fleet rollout).
