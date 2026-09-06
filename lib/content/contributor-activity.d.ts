// Type declarations for ./contributor-activity.mjs. The runtime lives in
// plain ESM so it can run under the Node test runner in `npm test`.

import type { ActivityEvent, ExamType } from "./mock-contributor-data";

export type ActivityAction = "subject" | "summary" | "exam" | "edit" | "delete";

// A single row returned by recent_contributor_activity(). Only public-safe
// fields: the actor id (and every other private profile/storage field) is
// intentionally absent.
export interface ActivityRow {
  id: string;
  is_own: boolean;
  actor_name_en: string | null;
  actor_name_ar: string | null;
  action: ActivityAction;
  title_en: string | null;
  title_ar: string | null;
  exam_type: ExamType | null;
  created_at: string;
}

export const ACTIVITY_ACTIONS_SQL: readonly ActivityAction[];
export const EXAM_TYPES_SQL: readonly ExamType[];
export const MAX_ACTIVITY_TITLE_LENGTH: 200;

export function isContributorActivityRow(value: unknown): value is ActivityRow;

// RPC rows (newest-first) to the frontend ActivityEvent[] the feed renders.
// Skips malformed rows, de-duplicates by id, drops events older than the
// 30-day visibility window, and localizes the actor name / title by `lang`.
export function toActivityEvents(
  rows: readonly ActivityRow[] | null | undefined,
  options?: { lang?: string; now?: Date | string },
): ActivityEvent[];