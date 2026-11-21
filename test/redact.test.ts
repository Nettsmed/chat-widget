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

  it("preserves Nettsmed public contact emails and phones", () => {
    expect(redactPII("Skriv til post@nettsmed.no eller sindre@nettsmed.no")).toBe(
      "Skriv til post@nettsmed.no eller sindre@nettsmed.no",
    );
    expect(redactPII("Ring 466 92 611")).toBe("Ring 466 92 611");
    expect(redactPII("Ring +47 466 92 611")).toBe("Ring +47 466 92 611");
    expect(redactPII("Ring 004746692611")).toBe("Ring 004746692611");
    expect(redactPII("Ring 46692611")).toBe("Ring 46692611");
  });

  it("preserves mailto: and tel: forms for Nettsmed contacts", () => {
    expect(redactPII("mailto:post@nettsmed.no")).toBe("mailto:post@nettsmed.no");
    expect(redactPII("mailto:sindre@nettsmed.no")).toBe("mailto:sindre@nettsmed.no");
    expect(redactPII("tel:46692611")).toBe("tel:46692611");
    expect(redactPII("tel:+4746692611")).toBe("tel:+4746692611");
  });

  it("still redacts visitor PII next to Nettsmed contacts", () => {
    expect(
      redactPII("Besøkende ola@firma.no, ring 91234567. Vi: post@nettsmed.no / 466 92 611"),
    ).toBe("Besøkende [email], ring [phone]. Vi: post@nettsmed.no / 466 92 611");
  });
});
