import { NextResponse } from "next/server";

/* Production liveness health endpoint for Render / external uptime probes.

   This is intentionally a PROCESS-LIVENESS check only:
   - Returns 200 with a static JSON body once the Next.js server is running and
     can serve a request. It performs no external I/O (no database, no Redis,
     no Supabase auth calls) so it never needs credentials, never leaks
     connection/secret details, and cannot itself take dependencies down.
   - It requires no authentication and exposes no secrets, keys, environment
     values, configuration, or internal details.
   - Deep "readiness" checks (DB connectivity etc.) are intentionally omitted:
     wiring them here would require service-role credentials and would cause
     false negatives during planned restarts/scale events on the Render side.
*/
export async function GET() {
  return NextResponse.json(
    { status: "ok" },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, private, max-age=0",
        "X-Robots-Tag": "noindex, nofollow",
      },
    }
  );
}
