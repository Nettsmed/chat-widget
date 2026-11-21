import {
  isPreservedEmail,
  isPreservedPhone,
  replaceUnlessPreserved,
} from "./pii-preserve";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * Norwegian phone numbers: optional +47 / 0047, then 8 digits starting 2–9,
 * with optional space / dot / hyphen separators.
 */
const NO_PHONE_RE =
  /(?<!\d)(?:(?:\+|00)47[\s.\-]?)?[2-9](?:[\s.\-]?\d){7}(?!\d)/g;

/**
 * Redact emails and Norwegian phone numbers for logs / error reporters.
 * Nettsmed public contacts (post@ / sindre@, 466 92 611) are left intact.
 */
export function redactPII(text: string): string {
  return replaceUnlessPreserved(
    replaceUnlessPreserved(text, EMAIL_RE, "[email]", isPreservedEmail),
    NO_PHONE_RE,
    "[phone]",
    isPreservedPhone,
  );
}
