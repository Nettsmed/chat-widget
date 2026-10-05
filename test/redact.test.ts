import { describe, it, expect } from "vitest";
import { redactPII } from "../server/redact";
import { redactPII as redactPIIFromServer } from "../server/index";

describe("redactPII", () => {
  it("replaces email addresses", () => {
    expect(redactPII("Write to ada@example.com please")).toBe("Write to [email] please");
    expect(redactPII("A.B+tag@sub.example.co.uk")).toBe("[email]");
  });

  it("replaces Norwegian phone numbers (with and without country code)", () => {
    expect(redactPII("Call +47 412 34 567")).toBe("Call [phone]");
    expect(redactPII("Call 004741234567")).toBe("Call [phone]");
    expect(redactPII("Ring 41234567 i dag")).toBe("Ring [phone] i dag");
    expect(redactPII("22 00 00 00")).toBe("[phone]");
  });

  it("does not redact unrelated text", () => {
    expect(redactPII("Prisen er 12345 kroner.")).toBe("Prisen er 12345 kroner.");
    expect(redactPIIFromServer("ada@example.com")).toBe("[email]");
  });
});
