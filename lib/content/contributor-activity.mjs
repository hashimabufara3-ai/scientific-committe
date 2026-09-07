// Pure, framework-free helpers for the contributor activity feed.
//
// This module is intentionally plain ESM (no TS, no imports) so it stays
// usable from the Node test runner in `npm test` — mirroring
// ./file-format.mjs. The TypeScript surfaces are declared in
// contributor-activity.d.ts next to this file.

export const ACTIVITY_ACTIONS_SQL = [
  "subject",
  "summary",
  "exam",
  "edit",
  "delete",
];

export const EXAM_TYPES_SQL = ["midterm", "final"];

// Cap enforced both by the DB table (check constraints on title_en/title_ar)
// and by the record RPC (truncation). Rows beyond it can never legitimately
// exist; the validator refuses them defensively.
export const MAX_ACTIVITY_TITLE_LENGTH = 200;

// A single row returned by recent_contributor_activity(). Only public-safe
// fields are ever present — the RPC never returns the actor id.
export function isContributorActivityRow(value) {
  if (value === null || typeof value !== "object") return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (!ACTIVITY_ACTIONS_SQL.includes(value.action)) return false;
  if (value.exam_type !== null && !EXAM_TYPES_SQL.includes(value.exam_type))
    return false;
  for (const key of ["title_en", "title_ar"]) {
    const title = value[key];
    if (
      title !== null &&
      (typeof title !== "string" || title.length > MAX_ACTIVITY_TITLE_LENGTH)
    )
      return false;
  }
  return true;
}

// The contributor_activity rows (newest-first, as returned by the RPC) to the
// frontend ActivityEvent[] shape the dashboard feed renders. Malformed rows
// are skipped, duplicates are dropped, and anything older than the 30-day
// visibility window is excluded. When a `viewerId` is supplied, the viewer's
// OWN events (is_own = true) are excluded too — the dashboard feed is
// intentionally "other contributors only", complementing the viewer's own
// "My Contributions" panel.
export function toActivityEvents(
  rows,
  { lang = "en", now = new Date(), viewerId } = {}
) {
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!isContributorActivityRow(row)) continue;
    if (viewerId && row.is_own === true) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (!isFresh(now, row.created_at)) continue;
    out.push(activityEventFromRow(row, lang));
  }
  return out;
}

function isFresh(now, createdAt) {
  const WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  const at = new Date(createdAt).getTime();
  if (Number.isNaN(at)) return false;
  return Date.parse(now) - at <= WINDOW_MS;
}

function activityEventFromRow(row, lang) {
  // Exam-family events carry the type enum (no free-text title) so the feed
  // can localize the label; everything else carries a bilingual title. Empty
  // or whitespace-only titles count as missing and fall back to the other
  // language's title; if neither exists the title stays undefined so the UI
  // renders a localized generic label instead of any identifier.
  const examType = row.exam_type ? row.exam_type : undefined;
  const title = examType
    ? undefined
    : cleanTitle(lang === "ar" ? row.title_ar : row.title_en) ??
      cleanTitle(lang === "ar" ? row.title_en : row.title_ar);

  return {
    id: row.id,
    kind: row.action,
    title,
    examType,
    actorName:
      (lang === "ar" ? row.actor_name_ar : row.actor_name_en) || undefined,
    isOwn: row.is_own,
    createdAt: Date.parse(row.created_at),
  };
}

// A usable title is a non-blank string; anything else is treated as missing.
function cleanTitle(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}