"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useActionState } from "react";
import { signIn } from "../../lib/auth/actions";
import {
  Field,
  PasswordInput,
  PrimaryButton,
  TextInput,
} from "../contribute/primitives";
import { AuthAlert } from "./auth-shell";
import type { DictionaryData } from "../../app/[lang]/dictionaries";

export function SignInForm({
  lang,
  dict,
  next,
  linkError,
  resetSuccess,
}: {
  lang: string;
  dict: DictionaryData["auth"];
  next?: string;
  linkError?: string;
  resetSuccess: boolean;
}) {
  const [state, formAction, pending] = useActionState(signIn, {});

  useEffect(() => {
    if (state.success && state.value) {
      window.location.replace(state.value);
    }
  }, [state]);

  return (
    <div className="space-y-6">
      {resetSuccess && (
        <AuthAlert variant="success">
          {dict.signIn.passwordResetSuccess}
        </AuthAlert>
      )}
      {linkError && <AuthAlert variant="error">{linkError}</AuthAlert>}
      {state.error && <AuthAlert variant="error">{state.error}</AuthAlert>}

      <form action={formAction} noValidate className="space-y-5">
        <input type="hidden" name="lang" value={lang} />
        <input
          type="hidden"
          name="next"
          value={next ?? `/${lang}`}
        />
        <Field label={dict.signIn.identifier} htmlFor="email" required>
          <TextInput
            id="email"
            name="email"
            type="text"
            autoComplete="username"
            placeholder={dict.signIn.identifierPlaceholder}
          />
        </Field>
        <Field label={dict.signIn.password} htmlFor="password" required>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            placeholder={dict.signIn.passwordPlaceholder}
            showLabel={dict.showPassword}
            hideLabel={dict.hidePassword}
          />
        </Field>
        <div className="flex justify-end">
          <Link
            href={`/${lang}/auth/forgot-password`}
            className="text-sm font-medium text-accent transition-colors hover:text-accent-bright"
          >
            {dict.signIn.forgotPassword}
          </Link>
        </div>
        <PrimaryButton type="submit" disabled={pending} className="w-full">
          {pending ? dict.signIn.submitLoading : dict.signIn.submit}
        </PrimaryButton>
      </form>
    </div>
  );
}
