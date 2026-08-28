/* Minimal structured (JSON-lines) logger for server-side code.

   Production intent:
   - Emits one JSON object per line to stdout (info/debug) or stderr
     (warn/error). Render captures stdout/stderr so these become queryable
     logs without any external logging service.
   - Dependency-free: no pino/winston, no network calls.

   Security contract:
   - Callers must pass only non-sensitive, structured fields. This module
     never inspects request/response objects and has no access to cookies,
     headers, env, or storage.
   - Explicitly drop values that look like credentials (service-role keys,
     tokens, passwords) even if a caller accidentally passes one, and
     length-cap every string so a single bad value cannot flood the log.
   - `message` is free-form text for humans; `fields` are key/value json-able
     scalars for search. Both are redacted and length-capped. */

type Level = "info" | "warn" | "error" | "debug";

const SENSITIVE_KEYS = /(pass|secret|token|key|authorization|cookie|credential)/i;
const SENSITIVE_VALUE =
  /(service_role|supabase_service_role|bearer\s+|-----BEGIN|eyJ[A-Za-z0-9_-]*\.)/i;

const MAX_STRING = 2000;

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    const capped = value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
    if (SENSITIVE_VALUE.test(capped)) return "[redacted]";
    return capped;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(redactValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[redacted]" : redactValue(v);
    }
    return out;
  }
  return typeof value === "function" || typeof value === "symbol"
    ? undefined
    : String(value);
}

function emit(level: Level, message: string, fields?: Record<string, unknown>): void {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: (message && message.slice(0, MAX_STRING)) || "",
  };
  if (fields && Object.keys(fields).length > 0) {
    record.fields = redactValue(fields);
  }
  const line = JSON.stringify(record);
  if (level === "error" || level === "warn") {
    // Never break the caller if stderr write fails.
    try {
      process.stderr.write(line + "\n");
    } catch {
      process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level }) + "\n");
    }
  } else {
    try {
      process.stdout.write(line + "\n");
    } catch {
      /* logging must never throw */
    }
  }
}

export const logger = {
  info: (message: string, fields?: Record<string, unknown>) =>
    emit("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) =>
    emit("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) =>
    emit("error", message, fields),
  debug: (message: string, fields?: Record<string, unknown>) =>
    emit("debug", message, fields),
};
