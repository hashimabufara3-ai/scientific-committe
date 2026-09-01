import { createAdminClient } from "../auth/supabase-server";
import { RESOURCES_BUCKET } from "./storage";

/* Orphaned Storage-object cleanup for the Resources/Summaries section.

   The direct-to-Storage upload flow (the browser PUTs bytes straight to the
   private bucket via a short-lived signed upload URL, then a server action
   validates and moves the object and creates the metadata row) can leave a
   Storage object with no referencing DB row when the flow is interrupted:

     - the user uploads successfully but closes/navigates away before the
       metadata action runs,
     - the network fails between upload and metadata creation,
     - a double-submit creates an extra object that never gets a row.

   The "metadata RPC fails" case is already compensated inline by the server
   action (it deletes the object). This sweep handles the rest: it periodically
   deletes Storage objects that are OLDER than a grace period and are NOT
   referenced by any summaries/exam_files row.

   The grace period prevents deleting an object that was just uploaded and is
   about to be committed by an in-flight metadata action. This is the same
   approach the migration comment promised ("the server action removes them
   separately"), extended to cover the interrupted-flow orphans.

   This runs server-side with the service-role client. It is triggered by a
   scheduler (host cron / Supabase cron) calling the guarded cleanup endpoint;
   it must never be exposed to the browser directly. */

export const ORPHAN_GRACE_MS = 6 * 60 * 60 * 1000; // 6 hours

type ListedObject = { name: string; created_at?: string };

/* List every object under a prefix (pagination loop, 1000 per page), recursing
   into subfolders. Storage list entries that carry an `id` are files; entries
   without one are folders (e.g. the quarantine/<userId>/ uploads). */
async function listPrefix(
  prefix: string,
  depth = 0
): Promise<ListedObject[]> {
  const admin = createAdminClient();
  const all: ListedObject[] = [];
  let offset = 0;
  const limit = 1000;

  for (;;) {
    const { data, error } = await admin.storage
      .from(RESOURCES_BUCKET)
      .list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const item of data) {
      const child = `${prefix}/${item.name}`;
      /* Folders have no `id`; descend (bounded) into them. */
      if (item.id) {
        all.push({ name: child, created_at: item.created_at ?? undefined });
      } else if (depth < 3) {
        const nested = await listPrefix(child, depth + 1);
        all.push(...nested);
      }
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return all;
}

/* Single page-list is sufficient for small catalogs; paginated loop above
   guards against growth. */

/* Collect the set of storage_paths currently referenced by any row (including
   inactive ones — a soft-deleted row's object may still be pending removal). */
async function referencedPaths(): Promise<Set<string>> {
  const admin = createAdminClient();
  const set = new Set<string>();

  for (const table of ["summaries", "exam_files"] as const) {
    let from = 0;
    const pageSize = 1000;
    for (;;) {
      const { data, error } = await admin
        .from(table)
        .select("storage_path")
        .not("storage_path", "is", null)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`read ${table}: ${error.message}`);
      for (const row of data ?? []) if (row.storage_path) set.add(row.storage_path);
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
  }
  return set;
}

/* Sweep: delete unreferenced objects older than the grace period.
   Returns counts for logging. Throws if anything fails (caller decide). */
export async function sweepOrphanedObjects(): Promise<{
  scanned: number;
  deleted: number;
}> {
  const admin = createAdminClient();
  const referenced = await referencedPaths();
  const now = Date.now();
  let scanned = 0;
  let deleted = 0;

  for (const prefix of ["summaries", "exams", "quarantine"]) {
    const objects = await listPrefix(prefix);
    const toDelete: string[] = [];

    for (const obj of objects) {
      scanned += 1;
      if (referenced.has(obj.name)) continue; // referenced — keep
      if (obj.created_at) {
        const age = now - new Date(obj.created_at).getTime();
        if (age < ORPHAN_GRACE_MS) continue; // too fresh — may be committing
      } else {
        // No timestamp available; keep (fail safe rather than delete).
        continue;
      }
      toDelete.push(obj.name);
    }

    if (toDelete.length > 0) {
      const { error } = await admin.storage
        .from(RESOURCES_BUCKET)
        .remove(toDelete);
      if (error) throw new Error(`remove: ${error.message}`);
      deleted += toDelete.length;
    }
  }

  return { scanned, deleted };
}
