"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { changeOwnPassword } from "../../lib/auth/actions";
import { Field, PasswordInput, SmallButton } from "../contribute/primitives";
import type { Dictionary } from "../../app/[lang]/dictionaries";

type AccountDict = Awaited<ReturnType<Dictionary>>["auth"]["account"];

/* Self-service password change block for the account page. Lets the signed-in
   user rotate their own password without an admin reset; the server action
   keeps the session active and rate-limits per user. On success the fields
   are cleared (DOM reset — it is a real external form, not React-controlled
   state) and a confirmation replaces the error line. */
export function ChangePasswordField({
  lang,
  t,
  showLabel,
  hideLabel,
}: {
  lang: string;
  t: AccountDict;
  showLabel: string;
  hideLabel: string;
}) {
  const [state, formAction, pending] = useActionState(changeOwnPassword, {});
  const formRef = useRef<HTMLFormElement>(null);

  const success = state.success && !pending;

  useEffect(() => {
    if (success) {
      formRef.current?.reset();
    }
  }, [success]);

  return (
    <div className="border-t border-white/10 pt-5">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
        {t.changePassword.title}
      </p>
      <form ref={formRef} action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="lang" value={lang} />
        <Field
          label={t.changePassword.newPassword}
          htmlFor="new-password"
          required
        >
          <PasswordInput
            id="new-password"
            name="password"
            autoComplete="new-password"
            placeholder={t.changePassword.newPasswordPlaceholder}
            showLabel={showLabel}
            hideLabel={hideLabel}
            defaultValue=""
          />
        </Field>
        <Field
          label={t.changePassword.confirmPassword}
          htmlFor="confirm-password"
          required
        >
          <PasswordInput
            id="confirm-password"
            name="confirmPassword"
            autoComplete="new-password"
            placeholder={t.changePassword.confirmPasswordPlaceholder}
            showLabel={showLabel}
            hideLabel={hideLabel}
            defaultValue=""
          />
        </Field>
        {state.error && (
          <p role="alert" className="text-xs text-red-300">
            {state.error}
          </p>
        )}
        {success && (
          <p role="status" className="text-xs text-green-300">
            {t.changePassword.success}
          </p>
        )}
        <SmallButton variant="accent" type="submit" disabled={pending}>
          {pending ? t.changePassword.submitting : t.changePassword.submit}
        </SmallButton>
      </form>
    </div>
  );
}