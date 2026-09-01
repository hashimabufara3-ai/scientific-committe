/* Server-only email configuration.

   Follows the same conventions as lib/security/rate-limit.ts and
   lib/auth/supabase-server.ts:

     - Reads credentials lazily from process.env; the module can be imported
       before configuration exists without throwing.
     - Environment variables must never be prefixed with NEXT_PUBLIC_ (they are
       server-only secrets).
     - Values are returned to callers, never logged.

   Required variables:
     RESEND_API_KEY            — Resend API key (server-only secret).
     EMAIL_FROM_ADDRESS        — verified "From" address, e.g.
                                 "PTUK Scientific Committee <noreply@mail.ptuksc.com>".
     EMAIL_ENABLED             — "true" enables real sends; any other value
                                 disables outbound email (safe default). */

function read(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export type EmailConfig = {
  apiKey: string;
  fromAddress: string;
  enabled: boolean;
};

let cached: EmailConfig | null = null;

/* Lazily build (and memoize) the resolved configuration. Returning null when a
   required value is missing lets callers decide how to fail (this module never
   throws at import time). */
export function getEmailConfig(): EmailConfig | null {
  if (cached !== null) return cached;

  const apiKey = read("RESEND_API_KEY");
  const fromAddress = read("EMAIL_FROM_ADDRESS");

  if (!apiKey || !fromAddress) {
    cached = null;
    return null;
  }

  cached = {
    apiKey,
    fromAddress,
    enabled: read("EMAIL_ENABLED") === "true",
  };

  return cached;
}

/* For tests / reloads only — clear the memoized configuration and re-read from
   process.env. */
export function resetEmailConfig(): void {
  cached = null;
}
