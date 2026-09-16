/* RFC 6266 / RFC 5987-safe Content-Disposition value builder.

   A stored resource's file_name is the contributor's original filename, which
   may contain Arabic or other non-ASCII/Unicode characters. Placing such bytes
   verbatim in a `filename="..."` header value is invalid: Node's HTTP layer
   rejects header characters beyond Latin-1 with ERR_INVALID_CHAR, turning the
   download into an HTTP 500 (Phase 3G).

   This module emits an ASCII-only header value:

     Content-Disposition: attachment; filename="<ascii-safe>"; filename*=UTF-8''<pct-encoded>

   - `filename="..."`  : ASCII-safe fallback for old clients (RFC 6266 fallback
     filename). Never contains quotes/CR/LF/backslash.
   - `filename*`        : RFC 5987 ext-value carrying the TRUE UTF-8 name,
     percent-encoded by byte so the header stays pure ASCII.

   Pure functions — no runtime imports — so the encoding is unit-testable in
   Node exactly like the TUS helpers. */
export const DISPOSITION_ATTACHMENT = "attachment";

/* Max chars for the filename portion. Short names keep the header small and
   avoid pathological local filesystem names while preserving the value. */
const MAX_FILENAME_CHARS = 200;
const SAFE_FALLBACK_NAME = "download";

/* RFC 5987 attr-char (the printable ASCII subset legal unencoded in an
   ext-value): ALPHA / DIGIT / "!" / "#" / "$" / "&" / "+" / "-" / "." / "^" /
   "_" / "`" / "|" / "~" */
const ATTR_CHAR_RE = /^[A-Za-z0-9!#$&+\-.^_`|~]$/;

/* C0 controls, DEL, plus the Unicode line separators (U+2028/U+2029):
   header-injection material. Quotes and backslash are also illegal inside a
   quoted-string / ext-value. */
const INJECTION_RE = /[\r\n\x00-\x1f\x7f\u2028\u2029"\\]/g;

/* Keep the existing sanitization/security behavior intact (strip CR/LF and
   header-injection characters and surrounding quotes, then fall back to a safe
   default). This is the guarded fallback string parsed out of the stored name;
   both the ASCII fallback and the RFC 5987 value derive from it. */
export function sanitizeStoredName(rawName: string | null | undefined): string {
  const cleaned = (rawName ?? "")
    .replace(INJECTION_RE, "")
    .trim()
    .slice(0, MAX_FILENAME_CHARS)
    .trim();
  return cleaned || SAFE_FALLBACK_NAME;
}

/* The extension is preserved on the ASCII fallback when it is a plain
   alphanumeric extension (no dots/slashes/controls). */
function splitExtension(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: "" };
  const ext = name.slice(dot + 1);
  if (/^[A-Za-z0-9]{1,10}$/.test(ext)) return { base: name.slice(0, dot), ext };
  return { base: name, ext: "" };
}

/* ASCII-safe quoted-string value for `filename="..."`. Non-ASCII characters
   (including anything outside Latin-1), spaces, quotes, backslashes and
   controls are rendered as an ASCII placeholder so the resulting header value
   is pure ASCII and can never break the quoted-string. The safe extension is
   retained when present. */
export function buildAsciiFallback(name: string): string {
  const { base, ext } = splitExtension(sanitizeStoredName(name));
  let fallback = "";
  for (const ch of base) {
    /* Keep printable ASCII except quotes/backslash/controls and path
       separators (a header filename must never carry "/" or "\\"). */
    fallback +=
      /^[\x20-\x7e]$/.test(ch) && /[^\x00-\x1f\x7f"\\/]/.test(ch) ? ch : "_";
  }
  fallback = (fallback || SAFE_FALLBACK_NAME)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .replace(/^[_ .]+|[_ .]+$/g, "")
    .slice(0, MAX_FILENAME_CHARS);
  if (!fallback) fallback = SAFE_FALLBACK_NAME;
  return ext ? `${fallback}.${ext}` : fallback;
}

/* RFC 5987 percent-encoding: emit `filename*=UTF-8''<encoded>` where every
   byte of the UTF-8 name outside the attr-char set is percent-encoded with
   upcase HEX. The return value INCLUDES the "UTF-8''" charset marker. */
export function buildExtendedFilename(name: string): string {
  let encoded = "UTF-8''";
  for (const byte of new TextEncoder().encode(sanitizeStoredName(name))) {
    const ch = String.fromCharCode(byte);
    encoded += ATTR_CHAR_RE.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
}

/* Full Content-Disposition value. ASCII names collapse to the simple
   `filename="..."` form; names with non-ASCII/Unicode get the two-parameter
   RFC 6266 form (fallback + RFC 5987 true name). Always pure ASCII output. */
export function buildContentDisposition(
  name: string | null | undefined
): string {
  const stored = sanitizeStoredName(name);
  const fallback = buildAsciiFallback(stored);
  if (stored === fallback) {
    return `${DISPOSITION_ATTACHMENT}; filename="${fallback}"`;
  }
  const extended = buildExtendedFilename(stored);
  return `${DISPOSITION_ATTACHMENT}; filename="${fallback}"; filename*=${extended}`;
}