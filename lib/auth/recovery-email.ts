/* Server-only helpers for the external recovery-email flow (Phase 2/3).

   Centralizes:
     - normalization / validation (reject @ptuksc.com + the caller's primary)
     - Supabase native recovery-link generation for an arbitrary external inbox
     - the Resend dispatch of that link via lib/email
     - enumeration-safe, log-safe behaviour

   Security contract (matches the rest of the codebase):
     - Only ever called from server actions / route handlers (never "use
       client"). Not browser-safe: it reads process.env/RESEND config and uses
       the service-role admin client.
     - Never logs the raw link, token, OTP, or full recovery address. Recipients
       are masked before any log output.
     - Never mutates auth.users.email.
     - Never creates a custom recovery_tokens table (native Supabase links only).
*/

import { createAdminClient } from "./supabase-server";
import { maskAddress } from "../email/mask";
import { sendEmail } from "../email";
import { logger } from "../logger";

const PTUKSC_DOMAIN_RE = /@ptuksc\.com$/i;

/* Email validation used across the recovery flow. */
export function isValidRecoveryEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/* Normalize to the same lower/trim form the DB unique index uses. */
export function normalizeRecoveryEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isPtukscEmail(value: string): boolean {
  return PTUKSC_DOMAIN_RE.test(value);
}

/* Describe a recovery address for any log output — never the raw value. */
export function describeRecoveryEmail(value: string): string {
  return maskAddress(value);
}

/* Generate a native Supabase recovery link for the primary @ptuksc.com email
   and deliver it to an EXTERNAL address via the Resend adapter.

   The link is generated server-side with the service-role admin client; the
   generated action_link is never returned to the browser and never logged.
   `redirectTo` is the callback URL the user lands on after verification (the
   same shape the existing forgotPassword flow uses, so the existing
   confirm/callback chain is reused unchanged).

   Returns true on success, false when outbound email is unavailable/disabled
   (caller should still show the generic success message to stay enum-safe).

   The copy is selected via `subject`/`intro`/`buttonLabel` so password-reset
   and recovery-email-verification messages can differ. The action_link is
   embedded by this helper and never exposed to the caller/browser/logs. */
export async function dispatchRecoveryLink({
  primaryEmail,
  toExternalEmail,
  redirectTo,
  subject,
  intro,
  buttonLabel,
}: {
  primaryEmail: string;
  toExternalEmail: string;
  redirectTo: string;
  subject: string;
  intro: string;
  buttonLabel: string;
}): Promise<boolean> {
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: primaryEmail,
    options: {
      redirectTo,
    },
  });

  if (error) {
    logger.warn("recovery link generation failed", {
      email: describeRecoveryEmail(primaryEmail),
      code: error.code ?? undefined,
    });
    return false;
  }

  const actionLink = data?.properties?.action_link;
  if (!actionLink) {
    logger.warn("recovery link generation returned no action_link", {
      email: describeRecoveryEmail(primaryEmail),
    });
    return false;
  }

  /* The action_link is consumed only as the email body. It is never logged and
     never exposed to the client bundle or returned to the caller. */
  const html = `<p>${intro}</p><p><a href="${actionLink}">${buttonLabel}</a></p>`;
  const text = `${intro}\n\n${buttonLabel}: ${actionLink}`;

  const result = await sendEmail({
    to: toExternalEmail,
    subject,
    html,
    text,
  });

  if (!result.ok) {
    logger.warn("recovery link dispatch failed", {
      to: describeRecoveryEmail(toExternalEmail),
      reason: result.reason,
    });
    return false;
  }

  return true;
}
