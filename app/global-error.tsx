"use client";

import { captureBoundaryError } from "../lib/security/sentry";

/* Root global error boundary (Next.js App Router).

   Runs outside the [lang] layout tree, so it must provide its own <html> and
   <body>. It renders only a safe, generic message — never error.message,
   error.stack, or any internal detail — and offers a recover (reset) action
   plus a full reload. Kept extremely lightweight by design.

   Accessibility: semantic <h1>, labelled buttons, visible keyboard focus,
   and no animation (safe under prefers-reduced-motion). */

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  /* P1-1A: Safe, fail-open internal error capture. Does NOT alter the visible
     error screen, its accessibility, or the recover/reload actions. Only a
     sanitized message and the error digest are sent; all sensitive data is
     stripped by redactEvent before transmission. */
  try {
    captureBoundaryError(error, {
      component: "global-error",
      digest: error.digest,
    });
  } catch {
    /* Tracking must never break the error boundary. */
  }

  return (
    <html lang="en" dir="ltr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Error</title>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0a0d12",
          color: "#edf0f4",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <main style={{ padding: "2rem 1.5rem", textAlign: "center", maxWidth: "26rem" }}>
          <p style={{ margin: 0, fontSize: "0.75rem", letterSpacing: "0.2em", color: "#2dd4bf" }}>
            ERROR
          </p>
          <h1 style={{ margin: "1rem 0 0", fontSize: "2rem", lineHeight: 1.2 }}>
            Something went wrong
          </h1>
          <p style={{ margin: "1.25rem auto 0", maxWidth: "24rem", lineHeight: 1.6, color: "#9aa3b2" }}>
            An unexpected error occurred. Please try again or reload the page.
          </p>
          <div style={{ marginTop: "2rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                borderRadius: "9999px",
                border: "0",
                background: "#2dd4bf",
                color: "#0a0d12",
                fontWeight: 600,
                padding: "0.75rem 1.5rem",
                fontSize: "0.875rem",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
              style={{
                borderRadius: "9999px",
                border: "1px solid rgba(255,255,255,0.15)",
                background: "transparent",
                color: "#edf0f4",
                fontWeight: 600,
                padding: "0.75rem 1.5rem",
                fontSize: "0.875rem",
                cursor: "pointer",
              }}
            >
              Reload page
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
