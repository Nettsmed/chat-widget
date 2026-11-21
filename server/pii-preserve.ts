/**
 * Nettsmed public contact details that must survive PII masking/redaction.
 * Visitor emails, phones and org numbers are still replaced as usual.
 */

const PRESERVE_EMAILS = new Set(["post@nettsmed.no", "sindre@nettsmed.no"]);

/** Digits only for Nettsmed's public mobile (466 92 611). */
const PRESERVE_PHONE_DIGITS = "46692611";

/** Digits only for Nettsmed AS org.nr. */
const PRESERVE_ORG_DIGITS = "934297571";

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** Strip optional Norwegian country prefix (47 / 0047) from a digit string. */
function nationalPhoneDigits(digits: string): string {
  if (digits.startsWith("0047") && digits.length === 12) return digits.slice(4);
  if (digits.startsWith("47") && digits.length === 10) return digits.slice(2);
  return digits;
}

export function isPreservedEmail(match: string): boolean {
  return PRESERVE_EMAILS.has(match.toLowerCase());
}

export function isPreservedPhone(match: string): boolean {
  return nationalPhoneDigits(digitsOnly(match)) === PRESERVE_PHONE_DIGITS;
}

export function isPreservedOrgNr(match: string): boolean {
  return digitsOnly(match) === PRESERVE_ORG_DIGITS;
}

/** Replace regex matches unless `keep` returns true for the match. */
export function replaceUnlessPreserved(
  text: string,
  re: RegExp,
  replacement: string,
  keep: (match: string) => boolean,
): string {
  return text.replace(re, (m) => (keep(m) ? m : replacement));
}
