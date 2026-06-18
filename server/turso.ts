import { createClient, type Client } from "@libsql/client";
import { runBackground } from "./scheduler";

let client: Client | null = null;

function getClient(): Client | null {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) return null;
  client = createClient({ url, authToken });
  return client;
}

export type LogMessage = {
  sessionId: string;
  messageId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  referer?: string | null;
  /** Only persisted when provided (privacy default: omit). Requires an `ip` column. */
  ip?: string | null;
};

/**
 * Logs a chat message to Turso. Fire-and-forget — never throws, never blocks
 * the streaming response. IP is only written when `ip` is provided.
 */
export function logMessage(msg: LogMessage): void {
  const c = getClient();
  if (!c) return;

  const content = msg.content.slice(0, 20000);
  const withIp = msg.ip !== undefined && msg.ip !== null;

  runBackground(
    c
      .execute(
        withIp
          ? {
              sql: `INSERT INTO conversations (session_id, message_id, role, content, referer, ip)
                    VALUES (?, ?, ?, ?, ?, ?)`,
              args: [msg.sessionId, msg.messageId, msg.role, content, msg.referer ?? null, msg.ip ?? null],
            }
          : {
              sql: `INSERT INTO conversations (session_id, message_id, role, content, referer)
                    VALUES (?, ?, ?, ?, ?)`,
              args: [msg.sessionId, msg.messageId, msg.role, content, msg.referer ?? null],
            },
      )
      .catch((err) => console.error("[turso] log failed:", err.message ?? err)),
  );

  maybePurgeOld(c);
}

// GDPR retention: delete conversations older than 90 days. Opportunistic —
// runs at most once per hour per serverless instance, fire-and-forget.
const RETENTION_DAYS = 90;
let lastPurge = 0;
function maybePurgeOld(c: Client): void {
  const now = Date.now();
  if (now - lastPurge < 3600_000) return;
  lastPurge = now;
  runBackground(
    c
      .execute(`DELETE FROM conversations WHERE created_at < datetime('now', '-${RETENTION_DAYS} days')`)
      .catch((err) => console.error("[turso] purge failed:", err.message ?? err)),
  );
}
