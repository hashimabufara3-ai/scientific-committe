import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  checkSignInRateLimit,
  checkAdminActionRateLimit,
  LIMITERS,
} from "./rate-limit.ts";

/* Shared helper that returns a Ratelimit-like object whose .limit() always
   rejects, simulating Upstash connectivity failure. */
function throwingLimiter() {
  return {
    limit: async () => {
      throw new Error("simulated Upstash failure");
    },
  };
}

/* ------------------------------------------------------------------ */
/*  checkAdminActionRateLimit — fail-closed                           */
/* ------------------------------------------------------------------ */

test("adminAction: fails closed when limiter is absent (no Upstash)", async () => {
  const result = await checkAdminActionRateLimit(null, "k");
  assert.deepEqual(result, { success: false });
});

test("adminAction: fails closed when Upstash throws", async () => {
  const result = await checkAdminActionRateLimit(throwingLimiter(), "k");
  assert.deepEqual(result, { success: false });
});

test("adminAction: succeeds when within limit (mock limiter)", async () => {
  const limiter = { limit: async () => ({ success: true }) };
  const result = await checkAdminActionRateLimit(limiter, "k");
  assert.deepEqual(result, { success: true });
});

/* ------------------------------------------------------------------ */
/*  checkRateLimit — remains fail-open for other limiters             */
/* ------------------------------------------------------------------ */

test("generic limiter: fails open when limiter is absent", async () => {
  const result = await checkRateLimit(null, "k");
  assert.deepEqual(result, { success: true });
});

test("generic limiter: fails open when Upstash throws", async () => {
  const result = await checkRateLimit(throwingLimiter(), "k");
  assert.deepEqual(result, { success: true });
});

/* ------------------------------------------------------------------ */
/*  checkSignInRateLimit — stays fail-closed (regression guard)       */
/* ------------------------------------------------------------------ */

test("signIn: fails closed when limiter is absent", async () => {
  const result = await checkSignInRateLimit(null, "k");
  assert.deepEqual(result, { success: false });
});

test("signIn: fails closed when Upstash throws", async () => {
  const result = await checkSignInRateLimit(throwingLimiter(), "k");
  assert.deepEqual(result, { success: false });
});

/* ------------------------------------------------------------------ */
/*  LIMITERS — object shape unchanged (smoke test)                    */
/* ------------------------------------------------------------------ */

test("LIMITERS exposes expected keys", () => {
  const keys = Object.keys(LIMITERS).sort();
  assert.deepEqual(keys, [
    "adminAction",
    "proxyGlobal",
    "resourceAccess",
    "signInEmail",
    "signInIp",
    "signUpIp",
    "updatePassword",
    "updateUsername",
    "usernameAvailable",
  ]);
});
