import { describe, it, expect } from "vitest";
import {
  hmacSha256Hex,
  timestampedHmacMessage,
  verifyTimestampedHmac,
} from "../server/hmac";

describe("timestamped HMAC", () => {
  it("signs <timestamp>.<body> with SHA-256", () => {
    expect(timestampedHmacMessage("1710000000", '{"a":1}')).toBe('1710000000.{"a":1}');
    const sig = hmacSha256Hex("secret", timestampedHmacMessage("1710000000", "body"));
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(
      verifyTimestampedHmac({
        secret: "secret",
        timestamp: "1710000000",
        body: "body",
        signature: sig,
      }),
    ).toBe(true);
  });

  it("rejects a wrong signature or secret", () => {
    const sig = hmacSha256Hex("secret", timestampedHmacMessage("1", "body"));
    expect(
      verifyTimestampedHmac({ secret: "secret", timestamp: "1", body: "body", signature: "ab" }),
    ).toBe(false);
    expect(
      verifyTimestampedHmac({ secret: "other", timestamp: "1", body: "body", signature: sig }),
    ).toBe(false);
  });

  it("rejects stale timestamps when maxAgeMs is set", () => {
    const ts = "1700000000";
    const body = "x";
    const sig = hmacSha256Hex("s", timestampedHmacMessage(ts, body));
    expect(
      verifyTimestampedHmac({
        secret: "s",
        timestamp: ts,
        body,
        signature: sig,
        maxAgeMs: 60_000,
        now: 1700000000 * 1000 + 120_000,
      }),
    ).toBe(false);
  });
});
