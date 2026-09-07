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

// The resource-kind enum of the contributor_activity.kind column (written at
// record time; NULL for rows written before kind-column migration).
export const ACTIVITY_KINDS_SQL = ["subject", "summary", "exam"];

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
  // `kind` is the resource the event refers to; NULL is legal (legacy rows).
  if (
    value.kind !== undefined &&
    value.kind !== null &&
    !ACTIVITY_KINDS_SQL.includes(value.kind)
  )
    return false;
  for (const key of ["title_en", "title_ar"]) {
    const title = value[key];
    if (
      title !== null &&
      title !== undefined &&
      (typeof title !== "string" || title.length > MAX_ACTIVITY_TITLE_LENGTH)
    )
      return false;
  }
  // Parent-subject names (subjects.title / title_ar) have no length cap on the
  // subjects table, so only a type check applies — a valid string must never
  // hide a whole activity row.
  for (const key of ["subject_name_en", "subject_name_ar"]) {
    const name = value[key];
    if (name !== null && name !== undefined && typeof name !== "string")
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

  // The parent subject's public name (set by the RPC join for summary/exam
  // events and for subject events referencing their own id). Same localized
  // fallback rules as `title`; stays undefined when the row has no usable
  // subject name so the UI renders a localized generic label instead of id.
  const subjectName =
    cleanTitle(lang === "ar" ? row.subject_name_ar : row.subject_name_en) ??
    cleanTitle(lang === "ar" ? row.subject_name_en : row.subject_name_ar);

  return {
    id: row.id,
    kind: row.action,
    resourceKind: row.kind ?? undefined,
    title,
    examType,
    subjectName,
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

/* Relative "time ago" label, kept PURE and framework-free so the natural
   plural/dual rules (Arabic in particular) are exercised deterministically in
   `npm test`. `forms` is the localized template block for one unit, e.g.
   { one, two, many, other } — `one`/`two` are literal strings, `many`/`other`
   are "{n}" templates. `justNow` is the sub-minute label.

   Arabic plural rules honored (11+ takes the singular/accusative form):
     1          -> one   (قبل دقيقة)
     2          -> two   (قبل دقيقتين)
     3..10      -> many  (قبل 3 دقائق)
     11+        -> other (قبل 11 دقيقة)
   days use «منذ» + يومًا in the accusative for 11+.
   English collapses two/many/other onto the {n}-template plural form. */
export function formatTimeAgo(ts, now, forms) {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return forms.justNow;
  if (minutes < 60) return unit(forms.minute, minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(forms.hour, hours);
  const days = Math.floor(hours / 24);
  return unit(forms.day, days);
}

function unit(forms, n) {
  const template =
    n === 1
      ? forms.one
      : n === 2
        ? forms.two
        : n <= 10 && n >= 3
          ? interp(forms.many, n)
          : interp(forms.other, n);
  // one/two are literal (no placeholder); many/other carry {n}.
  return template;
}

function interp(template, n) {
  return template.replace(/\{n\}/g, String(n));
}