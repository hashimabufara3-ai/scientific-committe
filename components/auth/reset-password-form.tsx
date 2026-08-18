"use client";

import { useActionState, useState, type FormEvent } from "react";
import { updatePassword } from "../../lib/auth/actions";
import { Field, PrimaryButton, TextInput } from "../contribute/primitives";
import { AuthAlert } from "./auth-shell";
import type { DictionaryData } from "../../app/[lang]/dictionaries";

export function ResetPasswordForm({
  lang,
  dict,
}: {
  lang: string;
  dict: DictionaryData["auth"];
}) {
  const [state, formAction, pending] = useActionState(updatePassword, {});
  const [fieldError, setFieldError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    let nextError: string | null = null;
    if (password.length < 6) {
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
        <Field label={dict.reset.password} htmlFor="password" required>
          <TextInput
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder={dict.reset.passwordPlaceholder}
          />
        </Field>
        <Field
          label={dict.reset.confirmPassword}
          htmlFor="confirmPassword"
          required
        >
          <TextInput
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder={dict.reset.confirmPasswordPlaceholder}
          />
        </Field>
        <PrimaryButton type="submit" disabled={pending} className="w-full">
          {pending ? dict.reset.submitLoading : dict.reset.submit}
        </PrimaryButton>
      </form>
    </div>
  );
}
