"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPassword } from "../../lib/auth/actions";
import { Field, PrimaryButton, TextInput } from "../contribute/primitives";
import { AuthAlert } from "./auth-shell";
import type { DictionaryData } from "../../app/[lang]/dictionaries";

export function ForgotPasswordForm({
  lang,
  dict,
}: {
  lang: string;
  dict: DictionaryData["auth"];
}) {
  const [state, formAction, pending] = useActionState(forgotPassword, {});

  if (state.success) {
    return (
      <div className="space-y-6">
        <AuthAlert variant="success">{dict.forgot.successBody}</AuthAlert>
        <Link
          href={`/${lang}/auth/sign-in`}
          className="btn-ghost w-full"
        >
          {dict.forgot.backToSignIn}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {state.error && <AuthAlert variant="error">{state.error}</AuthAlert>}

      <form action={formAction} noValidate className="space-y-5">
        <input type="hidden" name="lang" value={lang} />
        <Field label={dict.forgot.identifier} htmlFor="identifier" required>
          <TextInput
            id="identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            placeholder={dict.forgot.identifierPlaceholder}
          />
        </Field>
        <PrimaryButton type="submit" disabled={pending} className="w-full">
          {pending ? dict.forgot.submitLoading : dict.forgot.submit}
        </PrimaryButton>
      </form>

      <div className="text-center">
        <Link
          href={`/${lang}/auth/sign-in`}
          className="text-sm font-medium text-muted transition-colors hover:text-foreground"
        >
          {dict.forgot.backToSignIn}
        </Link>
      </div>
    </div>
  );
}
