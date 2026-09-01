/* Generic server-only outbound email abstraction (Phase 0).

   This is the ONLY public entry point for sending transactional email (today,
   intended for future password-recovery links once the hybrid recovery flow is
   built).

   Guarantees:
     - Server-only: importing/using this module from a browser bundle is not
       possible because it reads process.env and never ships credentials to the
       client. Do NOT mark it "use client".
     - Reads credentials from process.env (never logs them).
     - Fails clearly and safely when configuration is missing.
     - Never logs API keys, Authorization headers, or raw reset tokens; the
       recipient is masked before any log output.
     - Sends a REAL transactional email once the provider key/domain are set
       (no fake implementation). When EMAIL_ENABLED is not "true", it fails
       explicitly instead of silently pretending to send.

   Callers must supply at least one of `html` or `text`; both may be provided
   for multipart compatibility. */

import { getEmailConfig } from "./config";
import { sendViaResend } from "./resend";
import { maskAddress } from "./mask";
import { captureActionError } from "../security/sentry";
import { logger } from "../logger";

export type SendEmailInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: "unconfigured" | "disabled" | "validation" | "network" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Distinguish a "feature is off" state from a transient send error so callers
   can surface the right UX. */
export function isEmailEnabled(): boolean {
  return getEmailConfig()?.enabled === true;
}

export async function sendEmail(
  input: SendEmailInput
): Promise<SendEmailResult> {
  const to = typeof input.to === "string" ? input.to.trim() : "";
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const html = input.html?.trim() ?? "";
  const text = input.text?.trim() ?? "";

  if (!EMAIL_RE.test(to) || !subject || (!html && !text)) {
    return { ok: false, reason: "validation" };
  }

  const config = getEmailConfig();
  if (!config) {
    logger.warn("email not configured", { to: maskAddress(to) });
    return { ok: false, reason: "unconfigured" };
  }

  if (!config.enabled) {
    logger.warn("email disabled", { to: maskAddress(to) });
    return { ok: false, reason: "disabled" };
  }

  try {
    const sent = await sendViaResend(
      { to, subject, html, text, replyTo: input.replyTo?.trim() || undefined },
      config
    );
    return { ok: true, id: sent.id };
  } catch (err) {
    captureActionError(err, "sendEmail failed", {
      action: "sendEmail",
      component: "email",
      digest: undefined,
      code: undefined,
    });
    return { ok: false, reason: "network" };
  }
}
