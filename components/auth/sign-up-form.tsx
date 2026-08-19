"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, type FormEvent } from "react";
import { signUp } from "../../lib/auth/actions";
import { Field, PrimaryButton, TextInput } from "../contribute/primitives";
import { AuthAlert } from "./auth-shell";
import { createClient } from "../../lib/auth/supabase-browser";
import {
  isReservedUsername,
  isValidUsername,
  normalizeUsername,
} from "../../lib/auth/usernames";
import type { DictionaryData } from "../../app/[lang]/dictionaries";

type UsernameStatus =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "reserved";

/* Live, debounced availability check against username_available(). Advisory
   only — the database's case-insensitive unique index is the final authority
   and the server action re-checks before submitting. */
function useUsernameStatus() {
  const [status, setStatus] = useState<UsernameStatus>("idle");
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(
    null
  );

  function check(value: string) {
    if (timer) clearTimeout(timer);
    const username = normalizeUsername(value);
    if (!isValidUsername(username)) {
      setStatus("idle");
      return;
    }
    // Reserved names are rejected locally; they never reach the RPC.
    if (isReservedUsername(username)) {
      setStatus("reserved");
      return;
    }
    setStatus("checking");
    const next = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("username_available", {
        p_username: username,
      });
      setStatus(data === false ? "taken" : "available");
    }, 350);
    setTimer(next);
  }

  return { status, check };
}

export function SignUpForm({
  lang,
  dict,
}: {
  lang: string;
  dict: DictionaryData["auth"];
}) {
  const [state, formAction, pending] = useActionState(signUp, {});
  const [fieldError, setFieldError] = useState<string | null>(null);
  const { status, check } = useUsernameStatus();

  useEffect(() => {
    if (state.success) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [state.success]);

  if (state.success) {
    return (
      <div className="space-y-6">
        <AuthAlert variant="success">
          {dict.signUp.checkEmailBody}
        </AuthAlert>
        <Link
          href={`/${lang}/auth/sign-in`}
          className="btn-primary w-full"
        >
          {dict.signUp.signInLink}
        </Link>
      </div>
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const form = new FormData(event.currentTarget);
    const fullName = String(form.get("fullName") ?? "").trim();
    const username = normalizeUsername(String(form.get("username") ?? ""));
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    let nextError: string | null = null;
    if (!fullName) {
      nextError = dict.errors.required;
    } else if (!isValidUsername(username)) {
      nextError = dict.errors.usernameInvalid;
    } else if (status === "reserved" || isReservedUsername(username)) {
      nextError = dict.errors.usernameReserved;
    } else if (status === "taken") {
      nextError = dict.errors.usernameTaken;
    } else if (password.length < 6) {
      nextError = dict.errors.passwordTooShort;
    } else if (password !== confirmPassword) {
      nextError = dict.errors.passwordsMismatch;
    }
    if (nextError) {
      event.preventDefault();
      setFieldError(nextError);
    } else {
      setFieldError(null);
    }
  }

  return (
    <div className="space-y-6">
      {fieldError && <AuthAlert variant="error">{fieldError}</AuthAlert>}
      {state.error && <AuthAlert variant="error">{state.error}</AuthAlert>}

      <form
        action={formAction}
        onSubmit={handleSubmit}
        noValidate
        className="space-y-5"
      >
        <input type="hidden" name="lang" value={lang} />
        <Field label={dict.signUp.fullName} htmlFor="fullName" required>
          <TextInput
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            placeholder={dict.signUp.fullNamePlaceholder}
          />
        </Field>
        <Field label={dict.signUp.username} htmlFor="username" required>
          <TextInput
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            placeholder={dict.signUp.usernamePlaceholder}
            onChange={(event) => check(event.target.value)}
          />
          <p className="mt-1.5 text-xs text-muted">{dict.signUp.usernameHint}</p>
          {status === "taken" && (
            <p role="alert" className="mt-1.5 text-xs text-red-300">
              {dict.errors.usernameTaken}
            </p>
          )}
          {status === "reserved" && (
            <p role="alert" className="mt-1.5 text-xs text-red-300">
              {dict.errors.usernameReserved}
            </p>
          )}
          {status === "available" && (
            <p role="status" className="mt-1.5 text-xs text-accent">
              {dict.signUp.usernameAvailable}
            </p>
          )}
        </Field>
        <Field label={dict.signUp.email} htmlFor="email" required>
          <TextInput
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder={dict.signUp.emailPlaceholder}
          />
        </Field>
        <Field label={dict.signUp.password} htmlFor="password" required>
          <TextInput
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder={dict.signUp.passwordPlaceholder}
          />
        </Field>
        <Field
          label={dict.signUp.confirmPassword}
          htmlFor="confirmPassword"
          required
        >
          <TextInput
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder={dict.signUp.confirmPasswordPlaceholder}
          />
        </Field>
        <PrimaryButton type="submit" disabled={pending} className="w-full">
          {pending ? dict.signUp.submitLoading : dict.signUp.submit}
        </PrimaryButton>
      </form>

      <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-5">
        <p className="text-sm text-muted">{dict.signUp.haveAccount}</p>
        <Link
          href={`/${lang}/auth/sign-in`}
          className="text-sm font-semibold text-accent transition-colors hover:text-accent-bright"
        >
          {dict.signUp.signInLink}
        </Link>
      </div>
    </div>
  );
}
