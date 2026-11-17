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

### `afterTurn` (v0.9.0)

Optional hook that runs after the model finishes and before the stream closes. Use it to write
`data-*` parts (e.g. a stored plan the user can approve) that the client reads from `message.parts`.
The stream order is: model parts, your `data-*` parts, `finish`. If the hook throws, the error goes to
`onStreamError` and the stream still ends normally. Without the hook the response is unchanged.

```ts
afterTurn: async ({ text, steps, toolCalls, sessionId, writer }) => {
  writer.write({ type: "data-plan", id: "plan-1", data: { ops: [] } });
},
```

### Model options, model per turn, usage and timings (v0.10.0)

All optional; without them the handler behaves exactly as v0.9.2.

`providerOptions` goes straight to `streamText` (e.g. turn thinking off to cut time to first text):

```ts
providerOptions: { anthropic: { thinking: { type: "disabled" }, effort: "low" } },
```

`cacheTtl` sets the lifetime of the system-prompt cache breakpoint (Anthropic only; unset keeps the default):

```ts
cacheTtl: "1h", // "5m" | "1h"
```

`prepareTurn` may return `model` and/or `provider` for that turn only (omitted: the handler's own):

```ts
prepareTurn: ({ info }) => (info.faq ? { model: "claude-haiku-4-5-20251001" } : undefined),
```

`afterTurn` also receives `model`, `provider`, `usage` (summed across steps), `firstTextMs` (request start
to first text, undefined when no text) and `totalMs`:

```ts
afterTurn: ({ model, usage, firstTextMs, totalMs }) => {
  log({ model, ...usage, firstTextMs, totalMs }); // usage: inputTokens, cachedInputTokens, outputTokens
},
```

### PostHog `$ai_generation` events (v0.11.0)

Optional. With `posthog` set, each finished assistant turn sends one server-side `$ai_generation` event, so
PostHog LLM analytics shows cost per conversation and tenant. It carries model, provider, token counts, latency
(seconds), `$ai_trace_id` (the chat session id) and `tenant`. It never carries message content and no IP;
`distinct_id` is the session id, with `$process_person_profile: false` and `$geoip_disable: true`.

```ts
posthog: { apiKey: process.env.POSTHOG_KEY!, host: "https://eu.i.posthog.com", tenant: "acme" }, // host, tenant optional
```

Fire-and-forget over plain `fetch` (no dependency). A failure is passed to `onStreamError`; the stream is
never delayed or broken. Without `posthog` nothing is sent.

#### Opt-in message content: `captureContent` (v0.12.0)

```ts
posthog: { apiKey: process.env.POSTHOG_KEY!, captureContent: true } // default false
```

With `captureContent: true` the event also carries `$ai_input` (the user's latest message only, as
`[{ role: "user", content }]`) and `$ai_output_choices` (the final assistant text). **This sends message content,
masked, to PostHog.** Check that your privacy notice and data processing agreement cover it. Never included:
system prompt, retrieved knowledge, tool output. Each field is cut to 4000 characters.

Masking (`maskPii`, also exported from `/server`) runs before sending: emails become `[e-post]`, phone numbers
(Norwegian 8 digits with optional `+47`/`0047`, any `+<digits>`) `[telefon]`, Norwegian org numbers `[org.nr]`, and
runs of 11+ digits (card/account numbers) `[nummer]`. Prices such as "4 799 kr" and years are left alone. Masking
is pattern-based and best effort: names and free-text addresses are not masked.

### `MessageText` autoLinks and sameOriginTarget (v0.9.0)

```tsx
<MessageText
  text={text}
  tone="bot"
  autoLinks={[{ pattern: /\bNS-\d+\b/g, href: (m) => `/oppgaver/${m}` }]}
  sameOriginTarget="_self"
/>
```

`autoLinks` turns matches in plain text into links (not inside code or existing links; the `g` flag is
optional). `sameOriginTarget` sets the target for root-relative links (`/x`, not `//x`); without it the
existing link rules apply.

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
