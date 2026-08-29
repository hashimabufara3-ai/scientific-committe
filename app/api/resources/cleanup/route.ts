import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sweepOrphanedObjects } from "../../../../lib/content/orphan-cleanup";

/* Guarded cleanup endpoint for orphaned Storage objects.

   NOT intended for browser use. It is called by a scheduler (host cron /
   Supabase cron) which authenticates with a shared secret sent as `Authorization:
   Bearer <RESOURCE_CLEANUP_SECRET>`. The response only returns counts for
   logging — never object contents, credentials, or bucket info.

   If RESOURCE_CLEANUP_SECRET is not configured, the endpoint refuses to run
   (fail closed) so it cannot be triggered accidentally. */

export async function POST(request: NextRequest) {
  const secret = process.env.RESOURCE_CLEANUP_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await sweepOrphanedObjects();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: "cleanup_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 502 }
    );
  }
}
