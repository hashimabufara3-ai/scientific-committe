"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { forceChangePassword } from "../../lib/auth/actions";
import { Field, PrimaryButton, TextInput } from "../contribute/primitives";
import { AuthAlert } from "./auth-shell";
import type { DictionaryData } from "../../app/[lang]/dictionaries";

export function ChangePasswordForm({
  lang,
  dict,
}: {
  lang: string;
  dict: DictionaryData["auth"];
}) {
  const [state, formAction, pending] = useActionState(forceChangePassword, {});

  useEffect(() => {
    if (
      state.success &&
      state.value &&
      !state.recoveryAdded &&
      !state.recoveryError
    ) {
      window.location.replace(state.value);
    }
  }, [state]);

  return (
    <div className="space-y-6">
      <AuthAlert variant="success">
        {dict.changePassword.notice}
      </AuthAlert>

      {state.error && <AuthAlert variant="error">{state.error}</AuthAlert>}

      {/* OPTIONAL recovery-email step. A password change must never depend on
          it: an empty value keeps the exact pre-existing behaviour. */}
      {state.recoveryAdded && (
        <AuthAlert variant="success">
          {dict.changePassword.recoveryAdded}
        </AuthAlert>
      )}
      {state.recoveryError && (
        <AuthAlert variant="error">
          {dict.changePassword.recoveryAddFailed}
        </AuthAlert>
      )}

      <form action={formAction} noValidate className="space-y-5">
        <input type="hidden" name="lang" value={lang} />
        <Field label={dict.changePassword.newPassword} htmlFor="new-password" required>
          <TextInput
            id="new-password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder={dict.changePassword.newPasswordPlaceholder}
          />
        </Field>
        <Field
          label={dict.changePassword.confirmPassword}
          htmlFor="confirm-password"
          required
        >
          <TextInput
            id="confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder={dict.changePassword.confirmPasswordPlaceholder}
          />
        </Field>
        <Field
          label={dict.changePassword.recoveryEmail}
          optionalLabel={dict.changePassword.recoveryEmailOptional}
          htmlFor="recovery-email"
        >
          <TextInput
            id="recovery-email"
            name="recoveryEmail"
            type="email"
            autoComplete="off"
            placeholder={dict.changePassword.recoveryEmailPlaceholder}
          />
          <p className="mt-1.5 text-xs text-muted">
            {dict.changePassword.recoveryEmailHint}
          </p>
        </Field>
        <PrimaryButton type="submit" disabled={pending} className="w-full">
          {pending
            ? dict.changePassword.submitLoading
            : dict.changePassword.submit}
        </PrimaryButton>
      </form>

      {(state.recoveryAdded || state.recoveryError) && (
        <PrimaryButton
          type="button"
          className="w-full"
          onClick={() => window.location.assign(state.value ?? `/${lang}`)}
        >
          {dict.changePassword.continue}
        </PrimaryButton>
      )}
    </div>
  );
}
