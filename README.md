# @nettsmed/chat-widget

Shared core for the Nettsmed AI chat-widget fleet. The UI shell, markdown/data-bar
rendering, the generic API-route pipeline (rate-limit, abuse guards, Turso
logging, streaming + tool loop), the `widget.js` embed loader and the
site-bridge live here. Each consumer supplies only its config (theme, copy),
system prompt, tools/data adapter and host plugins.

**Visibility:** this repository is **public** on GitHub. Keep tenant-specific
prompts, secrets, pricing, policy text, tools, and customer data out of the
package — only generic engine hooks and helpers belong here.

## Consume (per-customer app)

`package.json`:
```jsonc
"@nettsmed/chat-widget": "github:Nettsmed/chat-widget#v0.8.0"
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

A v0.7.x-style config (no new options) is unchanged. Optional v0.8.0 hooks:

```ts
import {
  createChatHandler,
  resolveChatModel,
  redactPII,
  verifyTimestampedHmac,
} from "@nettsmed/chat-widget/server";

export const POST = createChatHandler({
  model: process.env.CHAT_MODEL ?? "claude-haiku-4-5",
  provider: "anthropic", // or "openai" (+ optional peer @ai-sdk/openai ^3)
  buildSystemPrompt: (content) => content,          // cached system block
  buildPageBlock: (page) => `Page: ${page.title} ${page.url}`, // uncached
  logMessages: (info) => !info.sessionId.startsWith("tmp-"),
  prepareTurn: async () => ({
    extraSystemBlock: undefined,
    extraHeaders: { "X-Jev-Route": "prompt_only" }, // widget already reads this
    disableSearchTool: false,
  }),
  checkAnswer: (text) => {
    // Report only — do not rewrite `text`.
    if (!text) return { message: "empty answer" };
  },
  verifyRequest: async (req, rawBody) =>
    verifyTimestampedHmac({
      secret: process.env.CHAT_HMAC_SECRET!,
      timestamp: req.headers.get("x-timestamp") ?? "",
      body: rawBody,
      signature: req.headers.get("x-signature") ?? "",
      maxAgeMs: 5 * 60_000,
    }),
  getTools: (_ctx, info) => {
    void info.page;
    void info.ip;
    void info.faq;
    return {};
  },
  errorMessage: "Beklager, noe gikk galt.",
});

void resolveChatModel; // also: resolveAnthropicModel (unchanged)
void redactPII;        // generic email + Norwegian phone redaction
```

## Theming

Brand colors are `--cw-*` CSS variables set from `config.colors` on the widget
root. Class strings are identical across tenants, so Tailwind scans the package
once. Never use per-brand arbitrary hex classes in the package.

## Use from raw serverless (non-Next)

`./server` has no React/Next dependency. In a plain Vercel Node/Edge function:

```ts
import { createChatHandler, setBackgroundRunner } from "@nettsmed/chat-widget/server";
// Optional: forward background work to the platform if available.
// import { waitUntil } from "@vercel/functions"; setBackgroundRunner(waitUntil);

export const POST = createChatHandler({
  model: "claude-haiku-4-5",
  apiKey: process.env.CLIENT_ANTHROPIC_KEY,          // BYOK (optional)
  spendCap: { tenantKey: "tilbud", dailyTokens: 200_000 },
  buildSystemPrompt: (content, page) => `...`,
  getTools: () => ({}),
  errorMessage: "Beklager, noe gikk galt.",
});
```

## Distribution

Public GitHub git-tag dependency (`github:Nettsmed/chat-widget#v0.8.0`).
Bump `version` in `package.json` and create tag `vX.Y.Z` **after merge**
(consumers pin tags). Customers adopt by bumping `#vX.Y.Z` independently
(no forced fleet rollout). Do not tag from an unmerged PR.
