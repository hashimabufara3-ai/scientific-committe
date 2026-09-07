// Type declarations for ./contributor-activity.mjs. The runtime lives in
// plain ESM so it can run under the Node test runner in `npm test`.

import type { ActivityEvent, ExamType } from "./mock-contributor-data";

export type ActivityAction = "subject" | "summary" | "exam" | "edit" | "delete";

// The resource-kind enum written to contributor_activity.kind at record time.
export type ActivityResourceKind = "subject" | "summary" | "exam";

// A single row returned by recent_contributor_activity(). Only public-safe
// fields: the actor id (and every other private profile/storage field) is
// intentionally absent.
export interface ActivityRow {
  id: string;
  is_own: boolean;
  actor_name_en: string | null;
  actor_name_ar: string | null;
  action: ActivityAction;
  /* Resource kind the event refers to. NULL for rows written before the kind
     column existed (no backfill) — the feed never guesses a legacy kind. */
  kind: ActivityResourceKind | null;
  title_en: string | null;
  title_ar: string | null;
  exam_type: ExamType | null;
  /* Parent subject's public bilingual title (joined in the RPC). NULL for
     events written before parent-subject tagging or with a missing subject. */
  subject_name_en: string | null;
  subject_name_ar: string | null;
  created_at: string;
}

export const ACTIVITY_ACTIONS_SQL: readonly ActivityAction[];
export const ACTIVITY_KINDS_SQL: readonly ActivityResourceKind[];
export const EXAM_TYPES_SQL: readonly ExamType[];
export const MAX_ACTIVITY_TITLE_LENGTH: 200;

export function isContributorActivityRow(value: unknown): value is ActivityRow;

// RPC rows (newest-first) to the frontend ActivityEvent[] the feed renders.
// Skips malformed rows, de-duplicates by id, drops events older than the
// 30-day visibility window, and localizes the actor name / title by `lang`.
// When `viewerId` is provided, the viewer's own events (is_own = true) are
// excluded server-side so the feed shows other contributors only.
export function toActivityEvents(
  rows: readonly ActivityRow[] | null | undefined,
  options?: { lang?: string; now?: Date | string; viewerId?: string },
): ActivityEvent[];

// Localized relative "time ago" label. `forms` is the t.activity.time block
// ({ justNow, minute, hour, day }, each unit being { one, two, many, other }).
// Pure so the Arabic dual/plural rules are testable in `npm test`.
export function formatTimeAgo(
  ts: number,
  now: number,
  forms: {
    justNow: string;
    minute: TimeUnitForms;
    hour: TimeUnitForms;
    day: TimeUnitForms;
  },
): string;

export interface TimeUnitForms {
  one: string;
  two: string;
  many: string;
  other: string;
}