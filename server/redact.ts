const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * Norwegian phone numbers: optional +47 / 0047, then 8 digits starting 2–9,
 * with optional space / dot / hyphen separators.
 */
const NO_PHONE_RE =
  /(?<!\d)(?:(?:\+|00)47[\s.\-]?)?[2-9](?:[\s.\-]?\d){7}(?!\d)/g;

/**
 * Redact emails and Norwegian phone numbers. Generic (not tenant-branded).
 * Intended for logs / error reporters.
 */
export function redactPII(text: string): string {
  return text.replace(EMAIL_RE, "[email]").replace(NO_PHONE_RE, "[phone]");
}
