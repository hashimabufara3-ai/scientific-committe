"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AuthError } from "@supabase/supabase-js";
import { getDictionary, hasLocale } from "../../app/[lang]/dictionaries";
import { createClient } from "./supabase-server";
import {
  isReservedUsername,
  isValidUsername,
  normalizeUsername,
} from "./usernames";
import { getServerActionIP } from "../security/ip";
import {
  checkRateLimit,
  checkSignInRateLimit,
  emailKey,
  LIMITERS,
} from "../security/rate-limit";
import { captureActionError } from "../security/sentry";

export type AuthState = {
  error?: string;
  success?: boolean;
  value?: string;
};

const MIN_PASSWORD_LENGTH = 6;

/* Timing-hardening delay (L-4): when a username does not resolve, the action
   would otherwise return immediately, whereas an existing-username + wrong-
   password attempt must do the full signInWithPassword() round-trip. This
   small bounded delay approximates that latency so the two cases are not
   distinguishable by response time. It is purely cosmetic timing-hardening —
   never part of authentication correctness, and removable/adjustable
   independently. Uses a Promise + setTimeout so it never blocks the event
   loop. */
function delayAuthProbe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 320));
}

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function readLang(formData: FormData): string {
  const lang = readString(formData, "lang");
  return hasLocale(lang) ? lang : "en";
}

/* Only allow same-site localized paths as redirect targets. */
function sanitizeNext(next: string, lang: string): string {
  if (
    (next === `/${lang}` || next.startsWith(`/${lang}/`)) &&
    !next.startsWith("//") &&
    !next.includes("://")
  ) {
    return next;
  }
  return `/${lang}`;
}

/* Map Supabase errors to safe, human-readable localized messages. Never reveal
   whether an email exists; enumeration-safe failures fall through to a
   generic message by design. */
function mapAuthError(
  error: AuthError,
  errors: DictionaryAuthErrors
): string {
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("invalid login credentials"))
    return errors.invalidCredentials;
  if (message.includes("email not confirmed"))
    return errors.emailNotConfirmed;
  if (
    message.includes("already registered") ||
    message.includes("already exists")
  )
    return errors.emailInUse;
  if (message.includes("at least 6 characters"))
    return errors.passwordTooShort;
  if (message.includes("security purposes")) return errors.rateLimited;
  // Supabase Auth throttles confirmation/password emails with
  // `over_email_send_rate_limit` (HTTP 429). Mapping it to the localized
  // "rate limited" message is far more useful than the generic fallback.
  if (
    error.code === "over_email_send_rate_limit" ||
    message.includes("rate limit")
  )
    return errors.rateLimited;
  if (message.includes("signups not allowed")) return errors.signupsDisabled;
  if (
    message.includes("network") ||
    message.includes("fetch failed") ||
    error.status === 0
  )
    return errors.network;
  if (
    message.includes("token has expired") ||
    message.includes("invalid token") ||
    message.includes("invalid code")
  )
    return errors.invalidToken;
  return errors.generic;
}

type DictionaryAuthErrors = Awaited<ReturnType<typeof getDictionary>>["auth"]["errors"];

/* Classify a Supabase Auth error as an EXPECTED, user-facing authentication
   rejection (wrong password, unconfirmed email, rate limit, invalid/expired
   link, signups disabled, …). Expected rejections must never create a Sentry
   event per attempt; everything else (network / provider / system / unknown)
   is an unexpected auth-system failure that observability SHOULD capture.

   Mirrors the exact cases mapAuthError already recognizes, so the capture
   decision and the localized user-facing classification can never diverge. */
function isExpectedAuthRejection(error: AuthError): boolean {
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("invalid login credentials")) return true;
  if (message.includes("email not confirmed")) return true;
  if (
    message.includes("already registered") ||
    message.includes("already exists")
  )
    return true;
  if (message.includes("at least 6 characters")) return true;
  if (message.includes("security purposes")) return true;
  if (
    error.code === "over_email_send_rate_limit" ||
    message.includes("rate limit")
  )
    return true;
  if (message.includes("signups not allowed")) return true;
  if (
    message.includes("token has expired") ||
    message.includes("invalid token") ||
    message.includes("invalid code")
  )
    return true;
  return false;
}

export async function signIn(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const lang = readLang(formData);
  const dict = await getDictionary(lang);
  const errors = dict.auth.errors;

  const identifier = readString(formData, "email").trim();
  const password = readString(formData, "password");

  if (!identifier) return { error: errors.required };
  if (!password) return { error: errors.required };

  /* Rate limit: 5 attempts / 15 min per IP AND per identifier (email or
     username). Enforced BEFORE username/email resolution so a non-existent
     username — which early-returns invalidCredentials below — still consumes
     rate-limit budget and cannot bypass the limiter.

     When CF-Connecting-IP is absent (direct Render access / local dev) the IP
     check is skipped — no shared bucket, no spoofing. The identifier check
     still runs and protects against cross-IP brute-force. emailKey() normalizes
     its input internally (trim + lowercase), so for an email identifier this
     bucket is identical to the previous emailKey(authEmail) key.

     Brute-force protection FAILS CLOSED: if Upstash/Redis is unavailable we
     deny the sign-in rather than silently admit unlimited attempts (see
     checkSignInRateLimit). */
  const ip = await getServerActionIP();
  const [ipOk, identifierOk] = await Promise.all([
    ip
      ? checkSignInRateLimit(LIMITERS.signInIp, ip)
      : ({ success: true } as const),
    checkSignInRateLimit(LIMITERS.signInEmail, emailKey(identifier)),
  ]);
  if (!ipOk.success || !identifierOk.success) {
    return { error: errors.rateLimited };
  }

  const supabase = await createClient();

  /* Resolve the identifier to an Auth email.
     If it contains "@", treat as email directly.
     Otherwise, resolve username → email via SECURITY DEFINER RPC. */
  let authEmail: string;
  const isEmail = identifier.includes("@");

  if (isEmail) {
    authEmail = identifier.toLowerCase();
  } else {
    const { data: resolvedEmail } = await supabase.rpc("resolve_auth_email", {
      p_identifier: identifier,
    });
    if (!resolvedEmail) {
      /* Generic failure — do not reveal whether the username exists.
         Timing-hardening: briefly delay so this fast path is not trivially
         distinguishable (by response time) from the slower signInWithPassword
         path taken for an existing username. */
      await delayAuthProbe();
      return { error: errors.invalidCredentials };
    }
    authEmail = resolvedEmail;
  }

  const next = sanitizeNext(readString(formData, "next"), lang);

  const { error } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password,
  });
  if (error) {
    /* Capture ONLY unexpected system/provider/network failures. Expected
       authentication rejections (invalid credentials, unconfirmed email,
       rate limits, invalid tokens, signups disabled) are user-facing and
       intentionally silent — do not create a Sentry event per attempt. */
    if (!isExpectedAuthRejection(error)) {
      captureActionError(
        error,
        "supabase.auth.signInWithPassword failed",
        {
          action: "signIn",
          route: `/${lang}/auth/sign-in`,
          code: error.code,
        }
      );
    }
    return { error: mapAuthError(error, errors) };
  }

  return { success: true, value: next };
}

export async function signUp(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const lang = readLang(formData);
  const dict = await getDictionary(lang);
  const errors = dict.auth.errors;

  /* Public self-registration is disabled. Accounts are created exclusively by
     administrators. Fail closed immediately — before validation, rate limiting,
     or any Supabase Auth call — so an anonymous client can never reach
     supabase.auth.signUp(). */
  return { error: errors.signupsDisabled };
}

/* ---------------------------------------------------------------------------
   Password management
   --------------------------------------------------------------------------- */

export async function updatePassword(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const lang = readLang(formData);
  const dict = await getDictionary(lang);
  const errors = dict.auth.errors;

  const password = readString(formData, "password");
  const confirmPassword = readString(formData, "confirmPassword");

  if (password.length < MIN_PASSWORD_LENGTH)
    return { error: errors.passwordTooShort };
  if (password !== confirmPassword)
    return { error: errors.passwordsMismatch };

  const supabase = await createClient();

  /* Rate limit: 5 attempts / hour per authenticated user */
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { success: allowed } = await checkRateLimit(
      LIMITERS.updatePassword,
      user.id
    );
    if (!allowed) return { error: errors.rateLimited };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    /* Unexpected auth-system failure in the password-update path. Expected
       auth rejections remain user-facing and silent. */
    if (!isExpectedAuthRejection(error)) {
      captureActionError(
        error,
        "supabase.auth.updateUser password change failed",
        {
          action: "updatePassword",
          route: `/${lang}/auth/reset-password`,
          code: error.code,
        }
      );
    }
    return { error: mapAuthError(error, errors) };
  }

  // Discard the recovery session and require a fresh sign-in.
  await supabase.auth.signOut();
  redirect(`/${lang}/auth/sign-in?reset=success`);
}

/* Map a profile UPDATE failure back to a localized message. The database is
   the final authority here, so constraint violations are authoritative even
   if the advisory pre-check raced or the reserved list drifted. */
function mapUsernameUpdateError(
  error: { message?: string },
  errors: DictionaryAuthErrors
): string {
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("duplicate") && message.includes("username")) {
    return errors.usernameTaken;
  }
  if (message.includes("profiles_username_format_check")) {
    return errors.usernameInvalid;
  }
  return errors.generic;
}

/* Change the signed-in user's own username. The row-level update policy
   ("update own profile") already confines writes to the caller's own row and
   keeps role immutable, so this can never touch another member or change a
   role. Uniqueness is enforced by the case-insensitive database index; the
   RPC pre-check and the reserved list here are advisory/UX plus a second
   server-side gate. Committee member usernames are immutable. */
export async function updateUsername(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const lang = readLang(formData);
  const dict = await getDictionary(lang);
  const errors = dict.auth.errors;

  const username = normalizeUsername(readString(formData, "username"));
  if (!isValidUsername(username)) return { error: errors.usernameInvalid };
  if (isReservedUsername(username)) return { error: errors.usernameReserved };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/auth/sign-in`);

  /* Committee member usernames are permanent. Reject any change attempt. */
  const { data: memberRow } = await supabase
    .from("committee_members")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (memberRow) {
    return { error: errors.usernameImmutable };
  }

  /* Rate limit: 5 attempts / hour per authenticated user */
  const { success: allowed } = await checkRateLimit(
    LIMITERS.updateUsername,
    user.id
  );
  if (!allowed) return { error: errors.rateLimited };

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.username === username) return { success: true };

  const { data: usernameAvailable } = await supabase.rpc("username_available", {
    p_username: username,
  });
  if (usernameAvailable === false) return { error: errors.usernameTaken };

  const { error } = await supabase
    .from("profiles")
    .update({ username })
    .eq("id", user.id);
  if (error) return { error: mapUsernameUpdateError(error, errors) };

  revalidatePath(`/${lang}/account`);
  return { success: true, value: username };
}

/* Rate-limited wrapper for the username_available() RPC. The client calls
   this instead of hitting Supabase directly, so we can enforce the 20/min
   per-IP limit on username enumeration. */
export type UsernameCheckState = {
  available?: boolean;
  error?: string;
};

export async function checkUsernameAvailability(
  _prev: UsernameCheckState,
  formData: FormData
): Promise<UsernameCheckState> {
  const username = normalizeUsername(readString(formData, "username"));
  if (!isValidUsername(username)) return { available: false };
  if (isReservedUsername(username)) return { available: false };

  /* Rate limit: 20 requests / minute per IP.
     When CF-Connecting-IP is absent, skip — no shared bucket. */
  const ip = await getServerActionIP();
  if (ip) {
    const { success: allowed } = await checkRateLimit(
      LIMITERS.usernameAvailable,
      ip
    );
    if (!allowed) return { error: "rateLimited" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("username_available", {
    p_username: username,
  });
  if (error) {
    captureActionError(error, "username_available RPC failed", {
      action: "checkUsernameAvailability",
      component: "sign-up-form",
      code: error.code,
    });
    return { available: false };
  }
  return { available: data !== false };
}

/* Force-change password action. Used when must_change_password is true.
   Unlike the standard updatePassword (which signs out), this keeps the
   session active and clears the must_change_password flag. */
export async function forceChangePassword(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const lang = readLang(formData);
  const dict = await getDictionary(lang);
  const errors = dict.auth.errors;

  const password = readString(formData, "password");
  const confirmPassword = readString(formData, "confirmPassword");

  if (password.length < MIN_PASSWORD_LENGTH)
    return { error: errors.passwordTooShort };
  if (password !== confirmPassword)
    return { error: errors.passwordsMismatch };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/auth/sign-in`);

  /* Rate limit: 5 attempts / hour per authenticated user */
  const { success: allowed } = await checkRateLimit(
    LIMITERS.updatePassword,
    user.id
  );
  if (!allowed) return { error: errors.rateLimited };

  /* Update password */
  const { error: pwError } = await supabase.auth.updateUser({ password });
  if (pwError) {
    /* Unexpected auth-system failure in the forced password-change path.
       Expected auth rejections remain user-facing and silent. */
    if (!isExpectedAuthRejection(pwError)) {
      captureActionError(
        pwError,
        "supabase.auth.updateUser forced password change failed",
        {
          action: "forceChangePassword",
          route: `/${lang}/auth/change-password`,
          code: pwError.code,
        }
      );
    }
    return { error: mapAuthError(pwError, errors) };
  }

  /* Clear must_change_password flag via SECURITY DEFINER function.
     The RLS "update own profile" policy restricts column changes, so we
     use the function which bypasses RLS. */
  const { error: mcpError } = await supabase.rpc("clear_must_change_password");
  if (mcpError) {
    captureActionError(mcpError, "clear_must_change_password failed", {
      action: "forceChangePassword",
      route: `/${lang}/auth/change-password`,
      code: mcpError.code,
    });
    /* Non-fatal: the password was changed. The proxy will continue to
       redirect, but the user can sign in with the new password. */
  }

  return { success: true, value: `/${lang}` };
}
