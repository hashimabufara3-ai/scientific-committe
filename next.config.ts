import type { NextConfig } from "next";

/* Static security headers, applied to every response (Option B — fit for a
   statically-rendered, self-hosted app; no third-party scripts/fonts/frames,
   so a fixed CSP with 'unsafe-inline' is safe and keeps static generation).

   CSP note:
   - The app is fully self-hosted: no runtime Google Fonts fetch (next/font
     self-hosts at build time), no iframes, no analytics scripts.
   - connect-src allows the Supabase project origin (auth/rest calls from the
     browser client) and YouTube's oEmbed endpoint (used for video titles).
   - style-src 'unsafe-inline' is required for the motion (framer-motion)
     component library, which sets inline style attributes during animations.
   - script-src 'unsafe-inline' matches Next's baseline for self-hosted apps.

   /auth/confirm is deliberately EXCLUDED from the global CSP so the Route
   Handler's own stricter policy (default-src 'none') remains authoritative on
   that token page — in Next 16, config headers() override Route Handler sets
   for the same key, so the global policy must not clobber it. */

const CONFIRM_PATH = /(?!auth\/confirm)/;

function buildCoreHeaders(): { key: string; value: string }[] {
  return [
    /* HSTS: only send when served over HTTPS. If the deployment server is
       plain HTTP (no TLS), remove this header or it will force browsers to
       refuse the site. 'preload' is intentionally excluded (one-way). */
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "X-Frame-Options",
      value: "SAMEORIGIN",
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    },
  ];
}

function buildContentSecurityPolicy(): string {
  const connectSources = [
    "'self'",
    "https://www.youtube.com",
    /* Sentry error reporting (P1-1A): the browser posts events to the
       ingest endpoint. Wildcard covers every DSN region/subdomain while
       still restricting connect-src to Sentry's host only. */
    "https://*.ingest.sentry.io",
  ];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      connectSources.push(new URL(supabaseUrl).origin);
    } catch {
      connectSources.push(supabaseUrl);
    }
  }

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  redirects: async () => [
    {
      source: "/",
      destination: "/ar",
      permanent: false,
    },
  ],
  async headers() {
    return [
      /* Every response gets the core (non-CSP) headers. */
      {
        source: "/(.*)",
        headers: buildCoreHeaders(),
      },
      /* The broad CSP applies everywhere EXCEPT /auth/confirm, where the
         Route Handler's strict policy must stay authoritative. */
      {
        source: `/(${CONFIRM_PATH.source}.*)`,
        headers: [
          {
            key: "Content-Security-Policy",
            value: buildContentSecurityPolicy(),
          },
        ],
      },
    ];
  },
};

export default nextConfig;