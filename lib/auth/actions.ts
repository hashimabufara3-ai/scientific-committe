"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AuthError } from "@supabase/supabase-js";
import { getDictionary, hasLocale } from "../../app/[lang]/dictionaries";
import { createClient, createAdminClient } from "./supabase-server";
import {
  isReservedUsername,
  isValidUsername,
  normalizeUsername,
} from "./usernames";
import { getServerActionIP } from "../security/ip";
import { checkRateLimit, emailKey, LIMITERS } from "../security/rate-limit";
import { captureActionError } from "../security/sentry";
import { logger } from "../logger";
import {
  dispatchRecoveryLink,
  isValidRecoveryEmail,
  normalizeRecoveryEmail,
  isPtukscEmail,
  describeRecoveryEmail,
} from "./recovery-email";

export type AuthState = {
  error?: string;
  success?: boolean;
  value?: string;
  /* Set when the password change succeeded but an OPTIONAL recovery email was
     also provided (first-time forced change). Carried separately so the UI can
     surface a distinct, recoverable state instead of claiming the recovery
     email was added when it was not. */
  recoveryAdded?: boolean;
  recoveryError?: boolean;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
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

async function getOrigin(): Promise<string> {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) return envUrl;

  const h = await headers();
  return (
    h.get("origin") ??
    h.get("x-origin") ??
    `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`
  );
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

  /* Rate limit: 5 attempts / 15 min per IP AND per resolved email.
     When CF-Connecting-IP is absent (direct Render access / local dev) the IP
     check is skipped — no shared bucket, no spoofing. The email check still
     runs and protects against cross-IP brute-force. */
  const ip = await getServerActionIP();
  const [ipOk, emailOk] = await Promise.all([
    ip
      ? checkRateLimit(LIMITERS.signInIp, ip)
      : ({ success: true } as const),
    checkRateLimit(LIMITERS.signInEmail, emailKey(authEmail)),
  ]);
  if (!ipOk.success || !emailOk.success) {
    return { error: errors.rateLimited };
  }

  const next = sanitizeNext(readString(formData, "next"), lang);

  const { error } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password,
  });
  if (error) return { error: mapAuthError(error, errors) };

  return { success: true, value: next };
}

export async function signUp(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const lang = readLang(formData);
  const dict = await getDictionary(lang);
  const errors = dict.auth.errors;

  const email = readString(formData, "email").trim();
  const fullName = readString(formData, "fullName").trim();
  const username = normalizeUsername(readString(formData, "username"));
  const password = readString(formData, "password");
  const confirmPassword = readString(formData, "confirmPassword");

  if (!isValidEmail(email)) return { error: errors.invalidEmail };
  if (!fullName) return { error: errors.required };
  if (!isValidUsername(username)) return { error: errors.usernameInvalid };
  if (isReservedUsername(username)) return { error: errors.usernameReserved };
  if (password.length < MIN_PASSWORD_LENGTH)
    return { error: errors.passwordTooShort };
  if (password !== confirmPassword)
    return { error: errors.passwordsMismatch };

  /* Rate limit: 3 attempts / hour per IP.
     When CF-Connecting-IP is absent, skip — no shared bucket. */
  const ip = await getServerActionIP();
  if (ip) {
    const { success: ipOk } = await checkRateLimit(LIMITERS.signUpIp, ip);
    if (!ipOk) return { error: errors.rateLimited };
  }

  const next = sanitizeNext(
    readString(formData, "next") || `/${lang}/account`,
    lang
  );
  const origin = await getOrigin();

  const supabase = await createClient();
  // Advisory pre-check only — the unique index on lower(profiles.username) is
  // the final authority. The trigger resolves any concurrent race
  // deterministically, and the reserved list is enforced again in SQL.
  const { data: usernameAvailable, error: availabilityError } =
    await supabase.rpc("username_available", {
      p_username: username,
    });  if (availabilityError) {
    captureActionError(availabilityError, "username_available RPC failed", {
      action: "signUp",
      route: `/${lang}/auth/sign-up`,
      code: availabilityError.code,
    });
  }
  if (usernameAvailable === false) return { error: errors.usernameTaken };

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, username },
      emailRedirectTo: `${origin}/${lang}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) {
    captureActionError(error, "supabase.auth.signUp failed", {
      action: "signUp",
      route: `/${lang}/auth/sign-up`,
      code: error.code,
    });
    return { error: mapAuthError(error, errors) };
  }

  // With email confirmation enabled there is no session yet — ask the user to
  // confirm. If confirmation is ever disabled, the session arrives immediately.
  if (data.session) redirect(next);

  return { success: true };
}

export async function forgotPassword(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const lang = readLang(formData);
  const dict = await getDictionary(lang);
  const errors = dict.auth.errors;

  const identifier = readString(formData, "identifier").trim();
  if (!identifier) return { error: errors.required };

  /* Rate limit: 3 requests / hour per IP AND per identifier.
     When CF-Connecting-IP is absent, skip the IP check — no shared bucket.
     The identifier check still runs and prevents cross-IP email bombing. */
  const ip = await getServerActionIP();
  const [ipOk, identifierOk] = await Promise.all([
    ip
      ? checkRateLimit(LIMITERS.forgotPasswordIp, ip)
      : ({ success: true } as const),
    checkRateLimit(LIMITERS.forgotPasswordEmail, emailKey(identifier.toLowerCase())),
  ]);
  if (!ipOk.success || !identifierOk.success) {
    return { error: errors.rateLimited };
  }

  const origin = await getOrigin();

  const supabase = await createClient();

  /* Resolve the identifier to the primary auth email (username OR @ptuksc.com
     email) via the existing SECURITY DEFINER RPC. NULL means "no such account"
     and is handled generically below so we never reveal existence. */
  let authEmail: string | null;
  const isEmail = identifier.includes("@");
  if (isEmail) {
    authEmail = identifier.toLowerCase();
  } else {
    const { data: resolvedEmail } = await supabase.rpc("resolve_auth_email", {
      p_identifier: identifier,
    });
    authEmail = resolvedEmail ?? null;
  }

  /* No such account (or identifier unresolved): generic success, with the same
     timing-hardening delay used on the sign-in fast path so the response time
     does not reveal whether an account exists. */
  if (!authEmail) {
    await delayAuthProbe();
    return { success: true };
  }

  /* Rate limit the recovery dispatch per account (defense in depth against
     targeted abuse even though enumeration is protected). */
  const { success: dispatchOk } = await checkRateLimit(
    LIMITERS.recoveryDispatch,
    authEmail
  );
  if (!dispatchOk) return { success: true }; // still generic

  /* Look up the account's VERIFIED external recovery email. Done with the
     server-only admin client so the address never reaches client code and the
     lookup stays private (service role bypasses RLS — never exposed). */
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("recovery_email, recovery_email_confirmed_at")
    .eq("email", authEmail)
    .maybeSingle();

  const recoveryEmail = profile?.recovery_email;
  const recoveryVerified = !!profile?.recovery_email_confirmed_at;

  const redirectTo = `${origin}/${lang}/auth/callback?next=${encodeURIComponent(
    `/${lang}/auth/reset-password`
  )}`;

  if (recoveryEmail && recoveryVerified) {
    /* Verified external recovery email: send the native Supabase recovery link
       there via Resend. NEVER call resetPasswordForEmail() on this branch (it
       targets auth.users.email) and NEVER send to @ptuksc.com. */
    const dispatched = await dispatchRecoveryLink({
      primaryEmail: authEmail,
      toExternalEmail: recoveryEmail,
      redirectTo,
      subject: "Reset your password",
      intro: "Use the link below to reset your password. If you did not request this, you can ignore this email.",
      buttonLabel: "Reset my password",
    });
    /* Enum-safe: regardless of delivery outcome we return the same generic
       success so we never reveal account/recovery/delivery state. */
    void dispatched;
    logger.info("recovery dispatch attempted", {
      to: describeRecoveryEmail(recoveryEmail),
      ok: dispatched,
    });
    return { success: true };
  }

  /* No verified external recovery email: preserve the existing native behavior
     exactly (Supabase sends the recovery link to auth.users.email). */
  const { error } = await supabase.auth.resetPasswordForEmail(authEmail, {
    redirectTo,
  });
  if (error) {
    const mapped = mapAuthError(error, errors);
    if (
      mapped === errors.rateLimited ||
      mapped === errors.network ||
      mapped === errors.generic
    ) {
      return { error: mapped };
    }
  }

  return { success: true };
}

/* ---------------------------------------------------------------------------
   External recovery-email management (Phase 2 / 5).

   All of these run server-side only. They:
     - require an authenticated user
     - validate + normalize the candidate external address
     - reject @ptuksc.com and the caller's own primary email
     - rate-limit every operation
     - send the verification/recovery link via the Resend adapter using Supabase
       native generateLink (never exposing the link to the browser)
     - never reveal whether an account/address exists (generic UX)
--------------------------------------------------------------------------- */

/* Begin adding/changing the caller's recovery email. Stores an UNVERIFIED
   candidate, then emails a verification link to it. The existing verified
   address (if any) is not usable for recovery until the new one is confirmed. */
export async function startRecoveryEmailChange(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const lang = readLang(formData);
  const dict = await getDictionary(lang);
  const errors = dict.auth.errors;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/auth/sign-in`);

  const candidate = normalizeRecoveryEmail(readString(formData, "email"));
  if (!candidate) return { error: errors.required };

  const result = await saveRecoveryEmailForUser({
    supabase,
    user,
    candidate,
    errors,
    lang,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/${lang}/account`);
  return { success: true };
}

/* Shared persistence for a recovery-email candidate. Used both by the account
   page (`startRecoveryEmailChange`) and by the OPTIONAL recovery field on the
   first-time forced password-change flow (`forceChangePassword`), so the
   validation rules, rate limiting, RPC and verification dispatch are never
   duplicated. Behaviour (matches the approved attempt 20260901120000):
     - validates with the existing recovery-email rules
     - applies the existing recoveryEmailSet rate limiter
     - stores an UNVERIFIED candidate via set_recovery_email (confirmed_at NULL)
     - emails a verification link through the existing dispatchRecoveryLink()
     - NEVER marks the address verified here — only the existing
       confirm_recovery_email() flow (via /auth/verify-recovery-email) can.
   Returns a localized message for every failure so callers can either surface
   it (account page) or collapse it into a generic recoverable state. */
type SaveRecoveryEmailResult = { ok: true } | { ok: false; error: string };

async function saveRecoveryEmailForUser({
  supabase,
  user,
  candidate,
  errors,
  lang,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email?: string | null };
  candidate: string;
  errors: DictionaryAuthErrors;
  lang: string;
}): Promise<SaveRecoveryEmailResult> {
  if (!isValidRecoveryEmail(candidate)) return { ok: false, error: errors.invalidEmail };
  if (isPtukscEmail(candidate)) return { ok: false, error: errors.recoveryEmailPtuksc };

  /* Do not allow the recovery address to equal the primary identity. */
  const primaryLower = (user.email ?? "").trim().toLowerCase();
  if (primaryLower === candidate) return { ok: false, error: errors.recoveryEmailPrimary };

  /* Rate limit set/change per user. */
  const { success: allowed } = await checkRateLimit(
    LIMITERS.recoveryEmailSet,
    user.id
  );
  if (!allowed) return { ok: false, error: errors.rateLimited };

  /* Persist the unverified candidate (DB enforces one-address-per-account via
     the unique index; the RPC also validates @ptuksc.com/primary/existence). */
  const { error: setError } = await supabase.rpc("set_recovery_email", {
    p_email: candidate,
  });
  if (setError) {
    captureActionError(setError, "set_recovery_email failed", {
      action: "saveRecoveryEmailForUser",
      route: `/${lang}/account`,
      code: setError.code,
    });
    const message = (setError.message ?? "").toLowerCase();
    if (message.includes("already in use")) return { ok: false, error: errors.recoveryEmailTaken };
    if (message.includes("ptuksc")) return { ok: false, error: errors.recoveryEmailPtuksc };
    if (message.includes("cannot be the account identity"))
      return { ok: false, error: errors.recoveryEmailPrimary };
    return { ok: false, error: errors.generic };
  }

  const origin = await getOrigin();

  /* Send the verification link to the candidate via Resend. Uses a native
     Supabase recovery link so the existing confirm/callback chain verifies it;
     the redirect lands on the email-verification confirm route. */
  await dispatchRecoveryLink({
    primaryEmail: primaryLower,
    toExternalEmail: candidate,
    redirectTo: `${origin}/${lang}/auth/callback?next=${encodeURIComponent(
      `/${lang}/auth/verify-recovery-email`
    )}`,
    subject: "Verify your recovery email",
    intro: "Use the link below to verify your recovery email. If you did not request this, you can ignore this email.",
    buttonLabel: "Verify my recovery email",
  });

  return { ok: true };
}

/* Resend a verification link to the caller's current (unverified) recovery
   email candidate. */
export async function resendRecoveryEmailVerification(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const lang = readLang(formData);
  const dict = await getDictionary(lang);
  const errors = dict.auth.errors;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/auth/sign-in`);

  const { success: allowed } = await checkRateLimit(
    LIMITERS.recoveryEmailVerify,
    user.id
  );
  if (!allowed) return { error: errors.rateLimited };

  /* Read the caller's current recovery email (server-only, own row). */
  const { data: profile } = await supabase
    .from("profiles")
    .select("recovery_email, recovery_email_confirmed_at")
    .eq("id", user.id)
    .maybeSingle();

  const candidate = profile?.recovery_email;
  if (!candidate || profile.recovery_email_confirmed_at) {
    /* Nothing to verify (none set, or already verified) — keep UX generic. */
    return { success: true };
  }

  const origin = await getOrigin();
  await dispatchRecoveryLink({
    primaryEmail: (user.email ?? "").trim().toLowerCase(),
    toExternalEmail: candidate,
    redirectTo: `${origin}/${lang}/auth/callback?next=${encodeURIComponent(
      `/${lang}/auth/verify-recovery-email`
    )}`,
    subject: "Verify your recovery email",
    intro: "Use the link below to verify your recovery email. If you did not request this, you can ignore this email.",
    buttonLabel: "Verify my recovery email",
  });

  return { success: true };
}

/* Clear the caller's recovery email entirely. */
export async function clearRecoveryEmail(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const lang = readLang(formData);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/auth/sign-in`);

  const { error } = await supabase.rpc("clear_recovery_email");
  if (error) {
    captureActionError(error, "clear_recovery_email failed", {
      action: "clearRecoveryEmail",
      route: `/${lang}/account`,
      code: error.code,
    });
    return { error: dict.auth.errors.generic };
  }

  return { success: true };
}

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
  if (error) return { error: mapAuthError(error, errors) };

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
  if (pwError) return { error: mapAuthError(pwError, errors) };

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

  /* OPTIONAL recovery email. Empty/blank keeps the exact pre-existing return
     path (must_change_password flow is unchanged). When provided, the same
     shared recovery persistence used by My Account runs AFTER the password
     change succeeds — two independent sequential operations, never a cross-
     system transaction. The password change always wins: a recovery failure is
     reported as a distinct recoverable state, never as a claim that the
     recovery email was saved. */
  const recoveryRaw = readString(formData, "recoveryEmail").trim();
  if (recoveryRaw) {
    const candidate = normalizeRecoveryEmail(recoveryRaw);
    if (candidate) {
      const result = await saveRecoveryEmailForUser({
        supabase,
        user,
        candidate,
        errors,
        lang,
      });
      if (result.ok) {
        return { success: true, value: `/${lang}`, recoveryAdded: true };
      }
    }
    return { success: true, value: `/${lang}`, recoveryError: true };
  }

  return { success: true, value: `/${lang}` };
}
