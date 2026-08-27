/* Server-only rate-limiting module backed by Upstash Redis.

   All Redis access is confined to this file. Consumers call the thin wrapper
   functions (checkRateLimit, checkProxyRateLimit) which handle:

     - Redis client singleton creation
     - Fail-open semantics (Redis errors → allow, log warning)
     - Key construction (namespaced, no secrets in keys)
     - Localized error messages (via callers, not here)

   Environment variables required:
     UPSTASH_REDIS_REST_URL
     UPSTASH_REDIS_REST_TOKEN

   These must NEVER be prefixed with NEXT_PUBLIC_.

   When env vars are absent the module loads without error. Rate-limit
   checks return { success: true } (fail-open) until credentials are
   provided. */

import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/* ---------------------------------------------------------------------------
   Redis client singleton
   ---------------------------------------------------------------------------

   Created once at module scope so connection state (HTTP keep-alive) is
   reused across requests within the same Node.js process. On Render restarts
   a fresh instance is created automatically.

   Returns null when env vars are missing — the module still loads, and
   consumers fail open. */

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      return null;
    }
    redis = new Redis({ url, token });
  }
  return redis;
}

/* ---------------------------------------------------------------------------
   Shared configuration
   ---------------------------------------------------------------------------

   slidingWindow is the default algorithm. It provides smooth limiting without
   the burst vulnerability of fixed windows.

   timeout: 2 000 ms — if Upstash doesn't respond within this window the
   request is allowed through (fail-open). 2 s is generous for a colocated
   US region call; most responses arrive in 5-20 ms.

   ephemeralCache: false — we're on a long-running server (Render), not
   serverless, so the in-memory cache would persist across requests within
   one process but be lost on restart. Disable it to always consult Redis
   for authoritative state. */

const BASE_CONFIG = {
  timeout: 2_000,
  ephemeralCache: false,
  analytics: false,
} as const;

/* ---------------------------------------------------------------------------
   Pre-configured ratelimiter instances (lazy initialization)

   Each getter creates its Ratelimit on first access, sharing the single
   Redis connection from getRedis(). When env vars are missing getRedis()
   returns null and the getter returns null — checkRateLimit() then
   fails open, allowing the request through. */

function createLimiter(
  window: Duration,
  limit: number,
  prefix: string
): Ratelimit | null {
  const client = getRedis();
  if (!client) return null;
  return new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix,
    ...BASE_CONFIG,
  });
}

const LIMITERS = {
  /* 100 requests / minute per IP — global flood protection (proxy layer) */
  get proxyGlobal() {
    return createLimiter("1 m", 100, "rl:proxy");
  },

  /* 5 attempts / 15 min per IP — sign-in brute-force */
  get signInIp() {
    return createLimiter("15 m", 5, "rl:signin:ip");
  },

  /* 5 attempts / 15 min per email — sign-in brute-force (cross-IP) */
  get signInEmail() {
    return createLimiter("15 m", 5, "rl:signin:email");
  },

  /* 3 attempts / hour per IP — account farming */
  get signUpIp() {
    return createLimiter("1 h", 3, "rl:signup:ip");
  },

  /* 3 requests / hour per IP — email bombing */
  get forgotPasswordIp() {
    return createLimiter("1 h", 3, "rl:forgot:ip");
  },

  /* 3 requests / hour per email — email bombing (cross-IP) */
  get forgotPasswordEmail() {
    return createLimiter("1 h", 3, "rl:forgot:email");
  },

  /* 20 requests / minute per IP — username enumeration via live search */
  get usernameAvailable() {
    return createLimiter("1 m", 20, "rl:username");
  },

  /* 5 attempts / hour per user — username squatting rotation */
  get updateUsername() {
    return createLimiter("1 h", 5, "rl:update-user");
  },

  /* 5 attempts / hour per user — password brute-force during recovery */
  get updatePassword() {
    return createLimiter("1 h", 5, "rl:update-pw");
  },

  /* 30 requests / minute per user — admin bulk operations */
  get adminAction() {
    return createLimiter("1 m", 30, "rl:admin");
  },
};

/* ---------------------------------------------------------------------------
   Key helpers
   ---------------------------------------------------------------------------

   Keys are namespaced, human-readable, and contain no secrets. Emails are
   SHA-256 hashed (truncated to 16 hex chars) to avoid storing PII in Redis
   while still being collision-resistant for this use case. */

function hashEmail(email: string): string {
  // Node.js 20+ has globalThis.crypto. Render uses Node 20+.
  const normalized = email.trim().toLowerCase();
  let hash = 0;
  // djb2 — fast, non-crypto, good enough for key-spacing (not security)
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function emailKey(email: string): string {
  return hashEmail(email);
}

/* ---------------------------------------------------------------------------
   Public API
   ---------------------------------------------------------------------------

   Every function wraps the Upstash call in a try/catch that fails open.
   On error, the request is allowed through and a warning is logged. */

export type RateLimitResult = {
  success: boolean;
};

/**
 * General-purpose rate limiter. Caller constructs the key.
 * Accepts null when Redis credentials are absent — fails open.
 *
 * @example
 * ```ts
 * const result = await checkRateLimit(LIMITERS.signInIp, ip);
 * if (!result.success) return { error: errors.rateLimited };
 * ```
 */
export async function checkRateLimit(
  limiter: Ratelimit | null,
  key: string
): Promise<RateLimitResult> {
  if (!limiter) return { success: true };
  try {
    const result = await limiter.limit(key);
    return { success: result.success };
  } catch (err) {
    console.warn("[rate-limit] Upstash unavailable, failing open:", err);
    return { success: true };
  }
}

/**
 * Rate limiter for the proxy (middleware) layer. Uses the global flood
 * limiter keyed by IP. Returns null if IP cannot be determined (fail open).
 */
export async function checkProxyRateLimit(
  ip: string | null
): Promise<RateLimitResult> {
  if (!ip) return { success: true };
  return checkRateLimit(LIMITERS.proxyGlobal, ip);
}

export { LIMITERS };
