/* Resend transactional-email adapter (server-only).

   Sends through Resend's REST API over plain HTTP fetch (no SMTP connection,
   no long-lived sockets), so it works from Node and serverless runtimes alike.
   No third-party email SDK is required — the API contract is a single POST.

   Security contract (mirrors lib/logger.ts and lib/security/redact.ts):
     - The API key is read from process.env via config and is NEVER logged.
     - The Authorization header and the full recipient address are never
       surfaced to logs; recipients are masked before any diagnostic output.
     - Raw password-reset tokens are never accepted/logged here — callers must
       embed them only in the email body and never pass them to this adapter's
       log path. */

import { getEmailConfig, type EmailConfig } from "./config";
import { maskAddress } from "./mask";
import { logger } from "../logger";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type SentEmail = {
  id: string;
};

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /* Optional Reply-To helps deliverability and user trust. Must be a verified
     address/domain. */
  replyTo?: string;
};

/* Build the masked log-safe representation of a recipient. Only the local-part
   prefix and the domain TLD are kept (e.g. "u***@gm***.com"), which is enough
   to trace which send failed without exposing the full address. */
function describeRecipient(to: string): string {
  return maskAddress(to);
}

/* Construct and perform the raw POST. Throws with a safe message on any
   transport/HTTP failure; the caller decides how to surface it. */
export async function sendViaResend(
  payload: EmailPayload,
  config: EmailConfig
): Promise<SentEmail> {
  const body = {
    from: config.fromAddress,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
  };

  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logger.warn("email resend transport failed", {
      to: describeRecipient(payload.to),
      reason: err instanceof Error ? err.message : "unknown",
    });
    throw new Error("Outbound email transport failed");
  }

  if (!response.ok) {
    let detail = "";
    try {
      const json = (await response.json()) as { message?: string };
      detail = json?.message ?? "";
    } catch {
      /* non-JSON error body — ignore */
    }
    logger.warn("email resend rejected", {
      to: describeRecipient(payload.to),
      status: response.status,
      detail,
    });
    throw new Error(`Outbound email rejected (${response.status})`);
  }

  const json = (await response.json()) as { id?: string };
  logger.info("email sent", { to: maskAddress(payload.to) });
  return { id: json?.id ?? "" };
}
