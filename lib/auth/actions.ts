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

  const email = readString(formData, "email").trim();
  const password = readString(formData, "password");

  if (!isValidEmail(email)) return { error: errors.invalidEmail };
  if (!password) return { error: errors.required };

  const next = sanitizeNext(readString(formData, "next"), lang);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
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
    });
  if (availabilityError) {
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
   server-side gate. */
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
