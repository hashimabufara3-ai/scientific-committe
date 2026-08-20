/* Safe client IP extraction for the Browser -> Cloudflare -> Render -> Next.js
   request chain.

   IP source: CF-Connecting-IP ONLY.

   CF-Connecting-IP is set by Cloudflare on ingress, always contains the true
   client IP, and cannot be spoofed by visitors. Cloudflare overwrites any
   client-supplied value before forwarding to origin.

   X-Forwarded-For and x-real-ip are NOT used because they can be spoofed
   when a request bypasses Cloudflare (direct IP access to Render). Trusting
   them would allow attackers to rotate through fake IPs and bypass all
   rate limiting.

   If CF-Connecting-IP is absent the request did not go through Cloudflare.
   This happens for Render health checks and local development. Callers
   must handle null (fail open for health checks; skip rate limiting). */

import { headers } from "next/headers";
import type { NextRequest } from "next/server";

/* Extract client IP from a NextRequest (proxy/middleware layer). */
export function getClientIP(request: NextRequest): string | null {
  const cf = request.headers.get("cf-connecting-ip");
  return cf ? cf.trim() : null;
}

/* Extract client IP inside Server Actions / Server Components where only
   the headers() API from next/headers is available. */
export async function getServerActionIP(): Promise<string | null> {
  const h = await headers();
  const cf = h.get("cf-connecting-ip");
  return cf ? cf.trim() : null;
}
