"use client";

import { useActionState, useState } from "react";
import {
  startRecoveryEmailChange,
  resendRecoveryEmailVerification,
  clearRecoveryEmail,
} from "../../lib/auth/actions";
import { Field, SmallButton, TextInput } from "../contribute/primitives";
import { AuthAlert } from "../auth/auth-shell";
import type { Dictionary } from "../../app/[lang]/dictionaries";

type AccountDict = Awaited<ReturnType<Dictionary>>["auth"]["account"];
type ErrorsDict = Awaited<ReturnType<Dictionary>>["auth"]["errors"];

/* Recovery-email section for the account page.

   Handles the three server-backed operations (all executed server-side):
     - start/change: store an unverified candidate, email a verification link
     - verify/resend: re-send the verification link for the current candidate
     - clear: remove the recovery email

   Display states:
     1. none        -> "Add recovery email"
     2. pending     -> masked address + "Verification pending" + resend/verify
     3. verified    -> masked address + "Verified"

   The full address is never accepted/rendered beyond the single form field;
   only the RPC-provided masked representation is shown. */
export function RecoveryEmailField({
  lang,
  maskedEmail,
  verified,
  t,
  errors,
}: {
  lang: string;
  maskedEmail: string | null;
  verified: boolean;
  t: AccountDict;
  errors: ErrorsDict;
}) {
  const [state, formAction, pending] = useActionState(startRecoveryEmailChange, {});
  const [resendState, resendAction, resendPending] = useActionState(
    resendRecoveryEmailVerification,
    {}
  );
  const [clearState, clearAction, clearPending] = useActionState(clearRecoveryEmail, {});
  const [editing, setEditing] = useState(false);

  const inFlight = pending || resendPending || clearPending;

  return (
    <div className="border-t border-white/10 pt-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
            {t.recoveryEmail}
          </p>
          {maskedEmail ? (
            <p className="mt-1 truncate font-mono text-sm text-accent">
              {maskedEmail}
              <span
                className={`ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  verified
                    ? "border-accent/30 bg-accent/10 text-accent"
                    : "border-amber-400/30 bg-amber-500/10 text-amber-300"
                }`}
              >
                {verified ? t.recoveryVerified : t.recoveryPending}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">{t.recoveryNotConfigured}</p>
          )}
        </div>

        {!maskedEmail && (
          <SmallButton
            variant="ghost"
            type="button"
            disabled={inFlight}
            onClick={() => {
              setEditing(true);
            }}
          >
            {t.addRecoveryEmail}
          </SmallButton>
        )}

        {maskedEmail && verified && (
          <div className="flex gap-2">
            <SmallButton
              variant="ghost"
              type="button"
              disabled={inFlight}
              onClick={() => {
                setEditing(true);
              }}
            >
              {t.changeRecoveryEmail}
            </SmallButton>
            <SmallButton
              variant="danger"
              type="button"
              disabled={inFlight}
              onClick={() => {
                const fd = new FormData();
                fd.set("lang", lang);
                clearAction(fd);
              }}
            >
              {t.clearRecoveryEmail}
            </SmallButton>
          </div>
        )}

        {maskedEmail && !verified && (
          <div className="flex gap-2">
            <SmallButton
              variant="accent"
              type="button"
              disabled={inFlight}
              onClick={() => {
                const fd = new FormData();
                fd.set("lang", lang);
                resendAction(fd);
              }}
            >
              {t.verifyRecoveryEmail}
            </SmallButton>
            <SmallButton
              variant="ghost"
              type="button"
              disabled={inFlight}
              onClick={() => {
                setEditing(true);
              }}
            >
              {t.changeRecoveryEmail}
            </SmallButton>
          </div>
        )}
      </div>

      {state.error && (
        <p role="alert" className="mt-3 text-xs text-red-300">
          {state.error}
        </p>
      )}
      {resendState.error && (
        <p role="alert" className="mt-3 text-xs text-red-300">
          {resendState.error}
        </p>
      )}
      {clearState.error && (
        <p role="alert" className="mt-3 text-xs text-red-300">
          {clearState.error}
        </p>
      )}

      {(state.success || resendState.success) && (
        <AuthAlert variant="success">{t.recoveryEmailSent}</AuthAlert>
      )}

      {editing && (
        <form action={formAction} className="mt-4 space-y-3">
          <input type="hidden" name="lang" value={lang} />
          <Field label={t.recoveryEmailNewLabel} htmlFor="recovery-email">
            <TextInput
              id="recovery-email"
              name="email"
              type="email"
              autoComplete="off"
              placeholder="you@gmail.com"
              autoFocus
            />
          </Field>
          <p className="text-xs text-muted">{t.recoveryEmailHint}</p>
          <div className="flex gap-2">
            <SmallButton
              variant="accent"
              type="submit"
              disabled={pending}
            >
              {t.sendVerification}
            </SmallButton>
            <SmallButton
              variant="ghost"
              type="button"
              disabled={pending}
              onClick={() => {
                setEditing(false);
              }}
            >
              {t.cancelRecoveryEmail}
            </SmallButton>
          </div>
        </form>
      )}
    </div>
  );
}
