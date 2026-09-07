/*
   Node test suite for lib/content/contributor-activity.mjs — the pure helpers
   behind the persisted contributor activity feed (RPC row validation and the
   mapping to the frontend ActivityEvent[] shape).

   Run with:
     node --test lib/content/contributor-activity.test.mjs
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_ACTIONS_SQL,
  EXAM_TYPES_SQL,
  MAX_ACTIVITY_TITLE_LENGTH,
  isContributorActivityRow,
  toActivityEvents,
} from "./contributor-activity.mjs";

// An ISO timestamp (rather than a Date) keeps the window-boundary assertions
// independent of the host timezone.
const NOW = "2026-09-06T00:00:00Z";

function row(overrides = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    is_own: false,
    actor_name_en: "Ahmed",
    actor_name_ar: "أحمد",
    action: "subject",
    title_en: "Calculus",
    title_ar: "حساب التفاضل",
    exam_type: null,
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

test("isContributorActivityRow accepts a well-formed RPC row", () => {
  assert.equal(isContributorActivityRow(row()), true);
  for (const action of ACTIVITY_ACTIONS_SQL) {
    assert.equal(isContributorActivityRow(row({ action })), true, action);
  }
  for (const examType of EXAM_TYPES_SQL) {
    assert.equal(isContributorActivityRow(row({ exam_type: examType })), true);
  }
});

test("isContributorActivityRow rejects rows with unknown action / exam type / payload", () => {
  assert.equal(isContributorActivityRow(null), false);
  assert.equal(isContributorActivityRow("x"), false);
  assert.equal(isContributorActivityRow({}), false);
  assert.equal(isContributorActivityRow(row({ id: "" })), false);
  assert.equal(isContributorActivityRow(row({ action: "remove" })), false);
  assert.equal(isContributorActivityRow(row({ exam_type: "bonus" })), false);
});

test("isContributorActivityRow enforces the 200-char title cap", () => {
  assert.equal(
    isContributorActivityRow(
      row({ title_en: "x".repeat(MAX_ACTIVITY_TITLE_LENGTH + 1) })
    ),
    false
  );
  assert.equal(
    isContributorActivityRow(row({ title_en: "x".repeat(200) })),
    true,
    "200-char boundary accepted"
  );
  assert.equal(
    isContributorActivityRow(
      row({ title_ar: "ل".repeat(MAX_ACTIVITY_TITLE_LENGTH + 1) })
    ),
    false
  );
  assert.equal(
    isContributorActivityRow(row({ title_ar: "ل".repeat(200) })),
    true,
    "200-char Arabic boundary accepted"
  );
  assert.equal(isContributorActivityRow(row({ title_en: 42 })), false);
  assert.equal(
    isContributorActivityRow(row({ title_en: null, title_ar: null })),
    true,
    "null titles stay valid (exam events rely on this)"
  );
});

test("activityEvents expose only safe public fields", () => {
  const events = toActivityEvents(
    [row({ is_own: true, exam_type: "final", title_en: null, title_ar: null })],
    { lang: "en", now: NOW }
  );
  assert.equal(events.length, 1);
  const event = events[0];
  assert.deepEqual(
    Object.keys(event).sort(),
    ["actorName", "createdAt", "examType", "id", "isOwn", "kind", "title"],
    "only the public event shape is ever returned"
  );
  for (const leaked of ["actor_id", "actorId", "email", "username", "full_name", "storage_path", "user_id"]) {
    assert.ok(!(leaked in event), `no ${leaked} leak`);
  }
});

test("toActivityEvents maps rows to the frontend event shape and localizes", () => {
  const events = toActivityEvents([row()], { lang: "en", now: NOW });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    id: "11111111-1111-1111-1111-111111111111",
    kind: "subject",
    title: "Calculus",
    examType: undefined,
    actorName: "Ahmed",
    isOwn: false,
    createdAt: Date.parse("2026-09-01T00:00:00Z"),
  });

  const ar = toActivityEvents([row()], { lang: "ar", now: NOW })[0];
  assert.equal(ar.actorName, "أحمد");
  assert.equal(ar.title, "حساب التفاضل");

  const fallback = toActivityEvents(
    [row({ title_en: null, title_ar: "الرياضيات" })],
    { lang: "en", now: NOW }
  )[0];
  assert.equal(fallback.title, "الرياضيات", "falls back to the other language");

  const own = toActivityEvents([row({ is_own: true })], { now: NOW })[0];
  assert.equal(own.isOwn, true);
  const nameless = toActivityEvents(
    [row({ actor_name_en: null, actor_name_ar: null })],
    { now: NOW }
  )[0];
  assert.equal(nameless.actorName, undefined);
});

test("empty titles are missing and fall back to the other language", () => {
  const ID = "460d7ae0-0f04-43f2-99b2-70bf2e7c5c69";
  // Arabic title empty: the English title wins in both locales.
  const en = toActivityEvents(
    [row({ id: ID, title_en: "Calculus", title_ar: "" })],
    { lang: "en", now: NOW }
  )[0];
  assert.equal(en.title, "Calculus");
  const ar = toActivityEvents(
    [row({ id: ID, title_en: "Calculus", title_ar: "" })],
    { lang: "ar", now: NOW }
  )[0];
  assert.equal(ar.title, "Calculus");
  // English title empty: the Arabic title wins in both locales.
  const enFallback = toActivityEvents(
    [row({ id: ID, title_en: "", title_ar: "الرياضيات" })],
    { lang: "en", now: NOW }
  )[0];
  assert.equal(enFallback.title, "الرياضيات");
  const arFallback = toActivityEvents(
    [row({ id: ID, title_en: "", title_ar: "الرياضيات" })],
    { lang: "ar", now: NOW }
  )[0];
  assert.equal(arFallback.title, "الرياضيات");
  // Whitespace-only counts as missing too.
  const ws = toActivityEvents(
    [row({ id: ID, title_en: "   ", title_ar: "الرياضيات" })],
    { lang: "en", now: NOW }
  )[0];
  assert.equal(ws.title, "الرياضيات");
  // Both empty: title is undefined — never the row id.
  const none = toActivityEvents(
    [row({ id: ID, title_en: "", title_ar: "" })],
    { lang: "ar", now: NOW }
  )[0];
  assert.equal(none.title, undefined);
});

test("the event id is never used as a title fallback", () => {
  const ID = "460d7ae0-0f04-43f2-99b2-70bf2e7c5c69";
  for (const action of ["subject", "summary", "edit", "delete"]) {
    for (const lang of ["en", "ar"]) {
      const event = toActivityEvents(
        [
          row({
            id: ID,
            action,
            title_en: null,
            title_ar: null,
            exam_type: null,
          }),
        ],
        { lang, now: NOW }
      )[0];
      assert.equal(event.title, undefined, `${action}/${lang}`);
      assert.notEqual(event.title, event.id, `${action}/${lang}`);
      assert.ok(
        !String(event.title ?? "").includes(ID),
        `${action}/${lang} must not leak the row id`
      );
    }
  }
});

test("toActivityEvents builds exam events from the type enum with no title", () => {
  const events = toActivityEvents(
    [row({ action: "exam", title_en: null, title_ar: null, exam_type: "final" })],
    { lang: "en", now: NOW }
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "exam");
  assert.equal(events[0].examType, "final");
  assert.equal(events[0].title, undefined);
});

test("toActivityEvents drops stale, duplicate, oversized and malformed rows", () => {
  const stale = row({ id: "a", created_at: "2026-07-31T00:00:00Z" });
  const fresh = row({ id: "b", created_at: "2026-09-05T00:00:00Z" });
  const duplicate = row(fresh);
  const oversized = row({
    id: "c",
    title_en: "y".repeat(MAX_ACTIVITY_TITLE_LENGTH + 1),
  });

  const events = toActivityEvents(
    [stale, fresh, duplicate, { id: "x" }, oversized],
    { now: NOW }
  );
  assert.deepEqual(events.map((e) => e.id), ["b"]);
});

test("toActivityEvents with a viewerId drops the viewer's own events, keeps others'", () => {
  const own = row({ id: "own-event", is_own: true });
  const other = row({ id: "other-event", is_own: false, actor_name_en: "Sara" });

  // The dashboard feed is "other contributors only": server-side, the viewer's
  // id is passed through so their own events never reach the browser.
  const withViewer = toActivityEvents([other, own, own], {
    lang: "en",
    now: NOW,
    viewerId: "u-viewer",
  });
  assert.deepEqual(
    withViewer.map((e) => e.id),
    ["other-event"]
  );
  assert.equal(withViewer[0].isOwn, false);

  // Without a viewerId (e.g. a future consumer that wants the combined feed)
  // the own event is still surfaced — the filter is opt-in, not a data loss.
  const withoutViewer = toActivityEvents([other, own], {
    lang: "en",
    now: NOW,
  });
  assert.deepEqual(
    withoutViewer.map((e) => e.id),
    ["other-event", "own-event"]
  );
});

test("toActivityEvents tolerates null input and keeps the window boundary", () => {
  assert.deepEqual(toActivityEvents(null, { now: NOW }), []);
  assert.deepEqual(toActivityEvents(undefined, { now: NOW }), []);
  assert.equal(
    toActivityEvents(
      [row({ created_at: "2026-08-07T00:00:00Z" })],
      { now: NOW }
    ).length,
    1,
    "30-day cutoff is inclusive"
  );
});