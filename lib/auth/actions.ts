"use server";

import { headers } from "next/headers";
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
import { checkRateLimit, emailKey, LIMITERS } from "../security/rate-limit";

export type AuthState = {
  error?: string;
  success?: boolean;
  value?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

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
      /* Generic failure — do not reveal whether the username exists. */
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
    console.error(
      "[auth] username_available() RPC failed:",
      availabilityError.code,
      availabilityError.message,
      availabilityError.details
    );
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
    console.error(
      "[auth] supabase.auth.signUp failed:",
      error.code,
      error.status,
      error.message
    );
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

  const email = readString(formData, "email").trim();
  if (!isValidEmail(email)) return { error: errors.invalidEmail };

  /* Rate limit: 3 requests / hour per IP AND per email.
     When CF-Connecting-IP is absent, skip the IP check — no shared bucket.
     The email check still runs and prevents cross-IP email bombing. */
  const ip = await getServerActionIP();
  const [ipOk, emailOk] = await Promise.all([
    ip
      ? checkRateLimit(LIMITERS.forgotPasswordIp, ip)
      : ({ success: true } as const),
    checkRateLimit(LIMITERS.forgotPasswordEmail, emailKey(email)),
  ]);
  if (!ipOk.success || !emailOk.success) {
    return { error: errors.rateLimited };
  }

  const origin = await getOrigin();

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/${lang}/auth/callback?next=${encodeURIComponent(`/${lang}/auth/reset-password`)}`,
  });
  if (error) {
    const mapped = mapAuthError(error, errors);
    // Surface only real failures (rate limiting, network). Everything else —
    // including "user not found" — shows the same safe success message.
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
    console.error("[auth] username_available() RPC failed:", error.code, error.message);
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
    console.error(
      "[auth] clear_must_change_password failed:",
      mcpError.code,
      mcpError.message
    );
    /* Non-fatal: the password was changed. The proxy will continue to
       redirect, but the user can sign in with the new password. */
  }

  return { success: true, value: `/${lang}` };
}
