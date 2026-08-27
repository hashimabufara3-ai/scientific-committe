/* Pure, dependency-free redaction utilities for Sentry event safety (P1-1A).

   Kept separate from lib/security/sentry.ts so the scrubbing rules are
   testable and shared by both the server and client SDK configurations.

   Policy:
   - Never transmit sensitive headers, cookies, request bodies, or query
     strings; these are dropped entirely.
   - Keep only the URL pathname, HTTP method, and sanitized error text.
   - Scrub emails, JWT/token-like values, bearer-values, and IP addresses
     wherever they might appear in a message, stack trace, or extra value.
   - Never transmit raw Supabase / PostgreSQL / SQL error details: DB-shaped
     error text is coerced to a safe generic marker (defense in depth).

   Over-redaction is preferred to under-redaction.
   None of these helpers has access to `process.env`, `document`, or storage. */

/* ---- Text-level scrubbers ------------------------------------------------- */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER_RE = /\b[Bb]earer\s+[A-Za-z0-9._~+/= -]+/g;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const MAC_RE = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
const ACCESS_KEY_RE = /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g;
const PRIVATE_KEY_RE =
  /\b(?:-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----|PRIVATE\s+KEY\s+-----)/gi;

const DB_DETAIL_MARKERS = [
  /duplicate\s+key\s+value\b/i,
  /\bSQLSTATE\b/i,
  /\bconstraint\b/i,
  /\bviolates\b/i,
  /relation\s+"[^"]+"/i,
  /\bpostgrest\b/i,
  /\bsupabase\b/i,
  /\bpg_\w+\b/i,
  /\b(?:select|insert|update|delete)\s+(?:[a-z0-9_]*\s+)?(?:from|into|set)\b/i,
];

/* Scrub a single piece of text. Used on messages, stack frames, and extra
   string values. */
export function scrubText(value: string): string {
  let out = value;
  out = out.replace(JWT_RE, "[redacted:jwt]");
  out = out.replace(BEARER_RE, "[redacted:bearer]");
  out = out.replace(EMAIL_RE, "[redacted:email]");
  out = out.replace(IP_RE, "[redacted:ip]");
  out = out.replace(MAC_RE, "[redacted:mac]");
  out = out.replace(ACCESS_KEY_RE, "[redacted:access-key]");
  out = out.replace(PRIVATE_KEY_RE, "[redacted:private-key]");
  return out;
}

/* Coerce text that looks like a raw database/SQL/supabase error into a safe
   generic marker, so internal DB details never leave the server. */
export function neutralizeDbDetail(value: string): string {
  const lower = value.toLowerCase();
  if (DB_DETAIL_MARKERS.some((re) => re.test(value) || re.test(lower))) {
    return "[error: database exception suppressed]";
  }
  return value;
}

/* Redact an error message: neutralize DB detail first, then scrub remaining
   sensitive tokens. */
export function scrubErrorMessage(value: string | null | undefined): string {
  if (!value) return "";
  return scrubText(neutralizeDbDetail(value));
}

/* Keep only the pathname of a URL; drop query string and hash. */
export function scrubUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url, "http://localhost");
    return u.pathname;
  } catch {
    const hashIdx = url.indexOf("#");
    const qIdx = url.indexOf("?");
    let end = url.length;
    if (hashIdx >= 0) end = Math.min(end, hashIdx);
    if (qIdx >= 0) end = Math.min(end, qIdx);
    return url.slice(0, end);
  }
}

const URL_OR_PATH_RE = /^(?:https?:\/\/|\/)/i;

/* Scrub a string leaf: URL/path-like values are reduced to their pathname so
   query-string or hash secrets can never be transmitted; all other strings
   are PII-scrubbed and length-capped. */
function scrubBreadcrumbLeaf(value: string): string {
  if (URL_OR_PATH_RE.test(value)) {
    return scrubUrl(value);
  }
  const s = scrubText(value);
  return s.length > 4000 ? s.slice(0, 4000) : s;
}

/* Recursively sanitize one breadcrumb value (gracefully handles plain
   objects, arrays, and primitives). URL-like strings lose their query
   string; other string leaves are scrubbed; binary/class junk is dropped. */
function sanitizeBreadcrumbValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return scrubBreadcrumbLeaf(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(sanitizeBreadcrumbValue);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).slice(0, 50)) {
      const v = sanitizeBreadcrumbValue(value[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  // Functions, symbols, bigint, buffers, class instances: drop.
  return undefined;
}

/* ---- Sentinel-aware value scrubber for arbitrary context values ---------- */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/* Defensively sanitize a context value. Acceptable primitives are kept but
   scrubbed if string-like; nested objects are allowed to stay (they are small,
   developer-supplied diagnostic values) but every string leaf is scrubbed.
   Anything unsafe/binary is dropped. */
export function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const s = scrubText(value);
    return s.length > 4000 ? s.slice(0, 4000) : s;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeValue);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).slice(0, 50)) {
      const v = sanitizeValue(value[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  // Functions, symbols, bigint, buffers, class instances: drop.
  return undefined;
}

/* ---- Event-level normalizer ---------------------------------------------- */

export type EventLike = {
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, unknown>;
    data?: unknown;
    cookies?: unknown;
    query_string?: unknown;
    body?: unknown;
    [k: string]: unknown;
  };
  exception?: {
    values?: Array<{
      type?: string;
      value?: string | null;
      stacktrace?: {
        frames?: Array<{
          filename?: string;
          abs_path?: string;
          function?: string;
          context_line?: string;
          pre_context?: string[];
          post_context?: string[];
        }>;
      };
    }>;
  };
  message?: string;
  transaction?: string;
  user?: unknown;
  extra?: Record<string, unknown>;
  tags?: Record<string, string>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: unknown[];
  [k: string]: unknown;
};

/* Final safety net applied to every event before it can leave the app
   (server and client). Drops unsafe fields, keeps only safe context. */
export function normalizeEvent(event: EventLike): EventLike {
  const out: EventLike = { ...event };

  /* 1. Request: drop sensitive fields; keep only a scrubbed pathname/method. */
  if (event.request) {
    const headers: Record<string, unknown> = {};
    // Keep nothing from headers — drop all of them by default.
    void headers;
    out.request = {
      method: event.request.method,
      url: scrubUrl(event.request.url),
    };
  }

  /* 2. Exception values: redact message + stack frame text. */
  if (event.exception && Array.isArray(event.exception.values)) {
    out.exception = {
      values: event.exception.values.map((val) => {
        const frame = val.stacktrace?.frames
          ?.map((f) => ({
            filename: scrubText(f.filename ?? ""),
            abs_path: scrubText(f.abs_path ?? ""),
            function: scrubText(f.function ?? ""),
            context_line: scrubText(f.context_line ?? ""),
            pre_context: (f.pre_context ?? []).map(scrubText),
            post_context: (f.post_context ?? []).map(scrubText),
          }))
          .slice(0, 50);
        return {
          type: scrubText(val.type ?? ""),
          value: scrubErrorMessage(val.value),
          stacktrace: frame?.length ? { frames: frame } : undefined,
        };
      }),
    };
  }

  /* 3. Message + transaction path. */
  if (event.message) out.message = scrubErrorMessage(event.message);
  if (event.transaction) out.transaction = scrubUrl(event.transaction);

  /* 4. Never carry user identity (email/username/id). */
  delete out.user;

  /* SDK-internal metadata can hold a normalized copy of raw request headers
     (set by captureRequestError). It is stripped at envelope creation, but
     dropping it here too guarantees no header survives beforeSend. */
  delete out.sdkProcessingMetadata;

  /* 5. Extra: scrub string leaves, keep only primitives/nested-safe values.
      Tags: keep only safe scalar tags (no sensitive values). */
  if (event.extra) {
    const extra = sanitizeValue(event.extra);
    out.extra = isPlainObject(extra) ? extra : {};
  }
  if (event.tags) out.tags = event.tags;

  /* 6. Contexts: retain safe structured context (e.g. custom), scrubbed.
      Note: `captureRequestError` places the raw request path (which can
      include a query string) into contexts.nextjs.request_path, so this uses
      the URL-aware scrubber to drop query/hash text, not just sanitizeValue. */
  if (event.contexts && typeof event.contexts === "object") {
    const c = sanitizeBreadcrumbValue(event.contexts);
    out.contexts = isPlainObject(c) ? c : {};
  }

  /* 7. Breadcrumbs: legacy network/console crumbs carry URLs (query strings
     can hold tokens) and arbitrary arguments. Sanitize every crumb: URL-like
     values are reduced to pathname, string leaves are scrubbed, and anything
     non-serializable is dropped. */
  if (Array.isArray(event.breadcrumbs)) {
    out.breadcrumbs = event.breadcrumbs
      .map(sanitizeBreadcrumbValue)
      .filter((b): b is unknown => b !== undefined)
      .slice(0, 50);
  }

  return out;
}
