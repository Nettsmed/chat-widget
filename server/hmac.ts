import { createHmac, timingSafeEqual } from "node:crypto";

/** Canonical HMAC message: `<timestamp>.<body>`. */
export function timestampedHmacMessage(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

/** Hex-encoded HMAC-SHA-256 of `message` with `secret`. */
export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function normalizeHex(signature: string): string {
  return signature.trim().toLowerCase().replace(/^sha256=/, "");
}

function hexToBytes(hex: string): Buffer | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  return Buffer.from(hex, "hex");
}

/**
 * Verify an HMAC-SHA-256 signature over `<timestamp>.<body>`.
 * Uses a constant-time compare. Optional `maxAgeMs` rejects stale timestamps
 * (unix seconds or milliseconds).
 */
export function verifyTimestampedHmac(opts: {
  secret: string;
  timestamp: string;
  body: string;
  signature: string;
  maxAgeMs?: number;
  now?: number;
}): boolean {
  const { secret, timestamp, body, signature, maxAgeMs, now = Date.now() } = opts;
  if (!secret || !timestamp || signature == null) return false;

  if (maxAgeMs != null) {
    const raw = Number(timestamp);
    if (!Number.isFinite(raw)) return false;
    const tsMs = raw < 1e12 ? raw * 1000 : raw;
    if (Math.abs(now - tsMs) > maxAgeMs) return false;
  }

  const expected = hmacSha256Hex(secret, timestampedHmacMessage(timestamp, body));
  const got = hexToBytes(normalizeHex(signature));
  const exp = hexToBytes(expected);
  if (!got || !exp || got.length !== exp.length) return false;
  return timingSafeEqual(got, exp);
}
