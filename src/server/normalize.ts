import { parsePhoneNumberFromString } from "libphonenumber-js";

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  return v.length ? v : null;
}

/**
 * Returns E.164 or null. Uses "possible" (length/shape) rather than "valid" (assigned ranges) so
 * fictional 555-01xx demo numbers normalize; production may tighten this per tenant policy.
 */
export function normalizePhone(raw: string | null | undefined, defaultCountry: "US" = "US"): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const p = parsePhoneNumberFromString(v, defaultCountry);
  return p && p.isPossible() ? p.number : null;
}

export function normalizeName(first: string, last: string): string {
  return `${first} ${last}`.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function displayName(first: string, last: string): string {
  return `${first} ${last}`.replace(/\s+/g, " ").trim();
}
