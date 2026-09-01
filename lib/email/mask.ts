/* Email address / sensitive-value masking for logging (server-only).

   Kept separate so the masking rules are unit-testable and shared by the
   email adapter and any future callers.

   Policy:
     - A full address is NEVER printed. Only the first local-part character,
       the "@", and the domain's TLD are kept.
       e.g.  "ali.kassab@ptuksc.com"  ->  "a***@com"
             "user+tag@gmail.com"     ->  "u***@com"
     - A single, unparseable recipient degrades to a fixed "[redacted]"
       marker rather than being echoed.
     - Any value that looks like a raw token/credential is replaced wholesale. */

const TOKEN_LIKE_RE =
  /\b(true|false)|\w{24,}\b|eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i;

/* Mask a single email address for safe logging. */
export function maskAddress(address: string): string {
  const value = typeof address === "string" ? address.trim() : "";

  // Unparseable or missing -> never echo it.
  if (!value || !value.includes("@")) return "[redacted]";

  const at = value.indexOf("@");
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);

  const first = local.length > 0 ? local[0] : "_";
  const dot = domain.lastIndexOf(".");
  const tld = dot >= 0 ? domain.slice(dot + 1) : domain;

  // Keep only the leading local-part char and the TLD.
  return `${first}***@${tld}`;
}

/* Sanitize an arbitrary string that may appear in a diagnostic log. Replaces
   full addresses and token-like strings, leaving the rest intact (it should be
   used on short, already-scoped values only). */
export function scrubEmailText(value: string): string {
  if (!value) return value;

  // Scrub token-like runs first.
  let out = value.replace(TOKEN_LIKE_RE, "[redacted]");

  // Then scrub any remaining email addresses.
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) =>
    maskAddress(m)
  );

  return out;
}
