/*
   Node test suite for lib/content/contributor-activity.mjs — the pure helpers
   behind the persisted contributor activity feed (RPC row validation and the
   mapping to the frontend ActivityEvent[] shape).

   Run with:
     node --test lib/content/contributor-activity.test.mjs
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVITY_ACTIONS_SQL,
  ACTIVITY_KINDS_SQL,
  EXAM_TYPES_SQL,
  MAX_ACTIVITY_TITLE_LENGTH,
  formatTimeAgo,
  isContributorActivityRow,
  toActivityEvents,
} from "./contributor-activity.mjs";

// The contribute-page transcripts under test live in the json dictionaries.
const dictionariesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../app/[lang]/dictionaries"
);
function readDict(locale) {
  return JSON.parse(
    readFileSync(resolve(dictionariesDir, `${locale}.json`), "utf8")
  );
}

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
    kind: null,
    title_en: "Calculus",
    title_ar: "حساب التفاضل",
    exam_type: null,
    subject_name_en: null,
    subject_name_ar: null,
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
  for (const kind of ACTIVITY_KINDS_SQL) {
    assert.equal(isContributorActivityRow(row({ kind })), true, `kind ${kind}`);
  }
  assert.equal(
    isContributorActivityRow(row({ kind: null })),
    true,
    "NULL kind (legacy row) is accepted"
  );
});

test("isContributorActivityRow rejects rows with unknown action / exam type / payload", () => {
  assert.equal(isContributorActivityRow(null), false);
  assert.equal(isContributorActivityRow("x"), false);
  assert.equal(isContributorActivityRow({}), false);
  assert.equal(isContributorActivityRow(row({ id: "" })), false);
  assert.equal(isContributorActivityRow(row({ action: "remove" })), false);
  assert.equal(isContributorActivityRow(row({ exam_type: "bonus" })), false);
  assert.equal(
    isContributorActivityRow(row({ kind: "chapter" })),
    false,
    "unknown kind rejected"
  );
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
    ["actorName", "createdAt", "examType", "id", "isOwn", "kind", "resourceKind", "subjectName", "title"],
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
    resourceKind: undefined,
    title: "Calculus",
    examType: undefined,
    subjectName: undefined,
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

test("isContributorActivityRow accepts bilingual parent-subject names", () => {
  for (const key of ["subject_name_en", "subject_name_ar"]) {
    assert.equal(
      isContributorActivityRow(row({ [key]: "Calculus" })),
      true,
      `string ${key} accepted`
    );
    assert.equal(
      isContributorActivityRow(row({ [key]: null })),
      true,
      `null ${key} accepted`
    );
    assert.equal(
      isContributorActivityRow(row({ [key]: 42 })),
      false,
      `non-string ${key} rejected`
    );
  }
});

test("exam and summary events carry the parent subject name from the authoritative row", () => {
  const SUBJ_EN = "Computer Networks";
  const SUBJ_AR = "شبكات الحاسوب";

  for (const examType of EXAM_TYPES_SQL) {
    const en = toActivityEvents(
      [
        row({
          action: "exam",
          title_en: null,
          title_ar: null,
          exam_type: examType,
          subject_name_en: SUBJ_EN,
          subject_name_ar: SUBJ_AR,
        }),
      ],
      { lang: "en", now: NOW }
    )[0];
    assert.equal(en.kind, "exam", examType);
    assert.equal(en.examType, examType, examType);
    assert.equal(en.title, undefined, "exam events never use a free-text title");
    assert.equal(en.subjectName, SUBJ_EN, `${examType} EN subject name`);

    const ar = toActivityEvents(
      [
        row({
          action: "exam",
          title_en: null,
          title_ar: null,
          exam_type: examType,
          subject_name_en: SUBJ_EN,
          subject_name_ar: SUBJ_AR,
        }),
      ],
      { lang: "ar", now: NOW }
    )[0];
    assert.equal(ar.subjectName, SUBJ_AR, `${examType} AR subject name`);
  }

  const summary = toActivityEvents(
    [
      row({
        action: "summary",
        title_en: "Chapter 1 notes",
        title_ar: "ملخص الفصل الأول",
        subject_name_en: SUBJ_EN,
        subject_name_ar: SUBJ_AR,
      }),
    ],
    { lang: "en", now: NOW }
  )[0];
  assert.equal(summary.title, "Chapter 1 notes");
  assert.equal(summary.subjectName, SUBJ_EN, "summary names its parent subject");

  const subject = toActivityEvents(
    [
      row({
        action: "subject",
        title_en: SUBJ_EN,
        title_ar: SUBJ_AR,
        subject_name_en: SUBJ_EN,
        subject_name_ar: SUBJ_AR,
      }),
    ],
    { lang: "en", now: NOW }
  )[0];
  assert.equal(subject.title, SUBJ_EN, "subject events keep their own name");
  assert.equal(subject.subjectName, SUBJ_EN);
});

test("subject names fall back across languages and to a safe undefined, never an id", () => {
  const ID = "460d7ae0-0f04-43f2-99b2-70bf2e7c5c69";

  // Arabic subject name present, English missing: use the AR name in both.
  const en = toActivityEvents(
    [row({ id: ID, subject_name_en: null, subject_name_ar: "الرياضيات" })],
    { lang: "en", now: NOW }
  )[0];
  assert.equal(en.subjectName, "الرياضيات");
  const ar = toActivityEvents(
    [row({ id: ID, subject_name_en: null, subject_name_ar: "الرياضيات" })],
    { lang: "ar", now: NOW }
  )[0];
  assert.equal(ar.subjectName, "الرياضيات");

  // Neither name present (rows written before subject tagging): subjectName is
  // undefined — the UI falls back to a localized generic label, never an id.
  const none = toActivityEvents(
    [row({ id: ID, subject_name_en: null, subject_name_ar: null })],
    { lang: "ar", now: NOW }
  )[0];
  assert.equal(none.subjectName, undefined);
  assert.ok(
    !String(none.subjectName ?? "").includes(ID),
    "must not leak the row id"
  );
});

test("activity transcript wording: indefinite exam types, subject-named sentences, no «السابق»", () => {
  const en = readDict("en").contributePage.activity;
  const ar = readDict("ar").contributePage.activity;

  // Exam types stay indefinite and temporally neutral in AR.
  assert.equal(ar.examTypes.midterm, "منتصف فصل");
  assert.equal(ar.examTypes.final, "نهائي");
  assert.equal(en.examTypes.midterm, "midterm");
  assert.equal(en.examTypes.final, "final");

  // The exam sentence names the parent subject and never says «السابق» /
  // «امتحان الفصل» / a definite "the" exam.
  assert.equal(ar.exam, 'شارك امتحان {examType} لمادة «{subject}»');
  assert.ok(!ar.exam.includes("السابق"), "no «السابق» in AR exam wording");
  assert.ok(!ar.exam.includes("امتحان الفصل"), "no «امتحان الفصل» in AR exam wording");
  assert.equal(en.exam, 'Shared a {examType} exam for "{subject}"');
  assert.ok(!en.exam.includes("previous"), "no 'previous' in EN exam wording");

  // Summaries and new subjects name the subject clearly.
  assert.equal(ar.summary, 'أضاف ملخصًا لمادة «{subject}»');
  assert.equal(en.summary, 'Added a summary for "{subject}"');
  assert.equal(ar.subject, 'أضاف مادة «{subject}»');
  assert.equal(en.subject, 'Added subject "{subject}"');

  // The subject sentence must name the subject exactly once (no duplication).
  for (const dict of [en, ar]) {
    assert.equal(
      (dict.subject.match(/\{subject\}/g) ?? []).length,
      1,
      "subject sentence mentions the subject exactly once"
    );
  }

  // Edit/delete wording: generic edit stays resource-title based; the generic
  // delete fallback is still used for legacy rows with no resource kind.
  assert.equal(en.edit, 'Edited "{title}"');
  assert.equal(en.delete, 'Deleted "{title}"');
  assert.equal(ar.edit, 'عدّل «{title}»');
  assert.equal(ar.delete, 'حذف «{title}»');
});

/* The delete wording must branch on the resource kind and — for the subject
   itself — use the SNAPSHOTTED title so a deleted subject still reads its real
   name (never the generic label, never an id). */
test("delete wording names the deleted resource kind and subject snapshot", () => {
  const ar = readDict("ar").contributePage.activity;
  const en = readDict("en").contributePage.activity;

  assert.equal(ar.deleteSubject, 'حذف مادة «{subject}»');
  assert.ok(!ar.deleteSubject.includes("بدون عنوان"), "no «بدون عنوان» in subject delete");
  assert.equal(ar.deleteSummary, 'حذف ملخصًا من مادة «{subject}»');
  assert.ok(!ar.deleteSummary.includes("لمادة"), "child delete must say من مادة");
  assert.ok(!ar.deleteSummary.includes("بدون عنوان"), "no «بدون عنوان» in summary delete");
  assert.equal(ar.deleteExam, 'حذف امتحان {examType} من مادة «{subject}»');
  assert.ok(!ar.deleteExam.includes("بدون عنوان"), "no «بدون عنوان» in exam delete");

  assert.equal(en.deleteSubject, 'Deleted subject "{subject}"');
  assert.equal(en.deleteSummary, 'Deleted a summary from "{subject}"');
  assert.equal(en.deleteExam, 'Deleted {examType} exam from "{subject}"');

  // Each delete template names the subject exactly once.
  for (const key of ["deleteSubject", "deleteSummary", "deleteExam"]) {
    assert.equal(
      (ar[key].match(/\{subject\}/g) ?? []).length,
      1,
      `AR ${key} names the subject exactly once`
    );
    assert.equal(
      (en[key].match(/\{subject\}/g) ?? []).length,
      1,
      `EN ${key} names the subject exactly once`
    );
  }
});

test("subject creation event maps to a visible event naming the subject", () => {
  const ID = "7f2a9e1b-5c11-4a62-9f0e-3a9b6c1d5e77";
  const SUBJECT_EN = "Data Structures";
  const SUBJECT_AR = "بنى البيانات";
  const event = toActivityEvents(
    [
      row({
        id: ID,
        action: "subject",
        kind: "subject",
        title_en: SUBJECT_EN,
        title_ar: SUBJECT_AR,
        subject_name_en: SUBJECT_EN,
        subject_name_ar: SUBJECT_AR,
      }),
    ],
    { lang: "ar", now: NOW }
  )[0];
  assert.equal(event.kind, "subject");
  assert.equal(event.resourceKind, "subject");
  assert.equal(event.title, SUBJECT_AR, "subject keeps its round-tripped name");
  assert.equal(event.subjectName, SUBJECT_AR);
  assert.ok(!event.title.includes("بدون عنوان"), "no generic label");
  assert.ok(!event.title.includes(ID), "title is not the id");
});

test("subject deletion event stays visible with its SNAPSHOTTED name", () => {
  const ID = "8b3c1f2d-4a71-4b62-a3d8-6c9d0e1f2a44";
  const SUBJECT_EN = "Operating Systems";
  const SUBJECT_AR = "أنظمة التشغيل";
  const event = toActivityEvents(
    [
      row({
        id: ID,
        action: "delete",
        kind: "subject",
        title_en: SUBJECT_EN,
        title_ar: SUBJECT_AR,
        subject_name_en: null,
        subject_name_ar: null,
      }),
    ],
    { lang: "ar", now: NOW }
  )[0];
  assert.equal(event.kind, "delete");
  assert.equal(event.resourceKind, "subject");
  /* The subjects row may be gone after deletion — the name comes from the
     SNAPSHOT (title), not from the join (subjectName). */
  assert.equal(event.title, SUBJECT_AR, "snapshot survives the joined row going null");
  assert.equal(event.subjectName, undefined);
  assert.ok(!event.title.includes("بدون عنوان"), "no «بدون عنوان»");
  assert.ok(!event.title.includes(ID), "snapshot is the real name, not a uuid");
});

/* Child summary/exam events of a DELETED subject are hidden by the READ RPC
   (recent_contributor_activity: rows stay visible when subject_id IS NULL or
   the subject is active or kind = 'subject'). React never hides rows — so this
   test pins the pure mapping's contract: (a) the feed renders exactly the rows
   the RPC already filtered (only the subject-self deletion survives), and
   (b) a missing subject NAME is never used to guess a row should be hidden
   (hiding is a data-source decision). */
test("feed renders only RPC-filtered rows; it never hides by a missing subject name", () => {
  const subjectDelete = row({
    id: "event-subj-del",
    action: "delete",
    kind: "subject",
    title_en: "Physics",
    title_ar: "الفيزياء",
    created_at: "2026-09-04T00:00:00Z",
  });
  const childSummary = row({
    id: "event-summary",
    action: "summary",
    kind: "summary",
    title_en: "Ch 1 notes",
    title_ar: "ملخص الفصل الأول",
    subject_name_en: "Physics",
    subject_name_ar: "الفيزياء",
    created_at: "2026-09-03T00:00:00Z",
  });

  // (a) The RPC has already dropped the children: the mapper must not re-add
  // what the data source did not return.
  const feed = toActivityEvents([subjectDelete], {
    lang: "ar",
    now: NOW,
  });
  assert.deepEqual(
    feed.map((e) => e.id),
    ["event-subj-del"],
    "only the subject-self deletion remains after RPC filtering"
  );

  // (b) When the RPC DOES return a child row with no joinable subject name
  // (e.g. pre-tagging), the pure mapper still surfaces it — hiding stays a
  // data-source concern, never a name heuristic in React.
  const stillReturned = toActivityEvents(
    [row({ id: childSummary.id, subject_name_en: null, subject_name_ar: null })],
    { lang: "ar", now: NOW }
  )[0];
  assert.equal(stillReturned.id, childSummary.id);
  assert.equal(stillReturned.subjectName, undefined);
});

/* The mapping layer must never reintroduce a UUID or the generic label for a
   deleted subject — the SNAPSHOT is the only source of the name. */
test("deleted subject wording never falls back to «بدون عنوان» or a uuid", () => {
  const ID = "5c4d0f3e-9b17-4c83-a2e6-8f1a2b3c4d55";
  for (const lang of ["ar", "en"]) {
    const event = toActivityEvents(
      [
        row({
          id: ID,
          action: "delete",
          kind: "subject",
          title_en: "Linear Algebra",
          title_ar: "الجبر الخطي",
        }),
      ],
      { lang, now: NOW }
    )[0];
    assert.equal(event.resourceKind, "subject");
    assert.equal(event.title, lang === "ar" ? "الجبر الخطي" : "Linear Algebra");
    const dict = lang === "ar" ? readDict("ar") : readDict("en");
    const label = dict.contributePage.activity.untitled;
    assert.ok(!event.title.includes(label), `${lang}: no generic label`);
    assert.ok(!String(event.title).includes(ID), `${lang}: no uuid`);
  }
});

test("summary delete from an EXISTING subject says «من مادة» with the subject name", () => {
  const AR_SUBJECT = "الشبكات";
  const event = toActivityEvents(
    [
      row({
        action: "delete",
        kind: "summary",
        title_en: "net",
        title_ar: "شبكة",
        subject_name_en: "Networks",
        subject_name_ar: AR_SUBJECT,
      }),
    ],
    { lang: "ar", now: NOW }
  )[0];
  assert.equal(event.resourceKind, "summary");
  assert.equal(event.subjectName, AR_SUBJECT);
  const ar = readDict("ar").contributePage.activity;
  const sentence = ar.deleteSummary
    .replace("{subject}", event.subjectName)
    .replace("{title}", event.title ?? "");
  assert.ok(sentence.includes("من مادة «الشبكات»"), "child delete names its live parent");
  assert.ok(!sentence.includes("بدون عنوان"), "live parent always has a name");
});

function arTime() {
  return readDict("ar").contributePage.activity.time;
}

test("Arabic time-ago: 1 hour -> قبل ساعة, 2 -> قبل ساعتين, 3..10 -> قبل N ساعات, 11+ -> قبل N ساعة", () => {
  const forms = arTime();
  const now = Date.parse("2026-09-06T00:00:00Z");
  assert.equal(formatTimeAgo(now - 1 * 60 * 60_000, now, forms), "قبل ساعة");
  assert.equal(formatTimeAgo(now - 2 * 60 * 60_000, now, forms), "قبل ساعتين");
  assert.equal(formatTimeAgo(now - 3 * 60 * 60_000, now, forms), "قبل 3 ساعات");
  assert.equal(formatTimeAgo(now - 10 * 60 * 60_000, now, forms), "قبل 10 ساعات");
  assert.equal(formatTimeAgo(now - 11 * 60 * 60_000, now, forms), "قبل 11 ساعة");
  assert.equal(formatTimeAgo(now - 20 * 60 * 60_000, now, forms), "قبل 20 ساعة");
});

test("Arabic time-ago: 1 دقيقة -> قبل دقيقة, 2 -> قبل دقيقتين, 3..10 -> قبل N دقائق, 11+ -> قبل N دقيقة", () => {
  const forms = arTime();
  const now = Date.parse("2026-09-06T00:00:00Z");
  assert.equal(formatTimeAgo(now - 1 * 60_000, now, forms), "قبل دقيقة");
  assert.equal(formatTimeAgo(now - 2 * 60_000, now, forms), "قبل دقيقتين");
  assert.equal(formatTimeAgo(now - 3 * 60_000, now, forms), "قبل 3 دقائق");
  assert.equal(formatTimeAgo(now - 10 * 60_000, now, forms), "قبل 10 دقائق");
  assert.equal(formatTimeAgo(now - 11 * 60_000, now, forms), "قبل 11 دقيقة");
  assert.equal(formatTimeAgo(now - 59 * 60_000, now, forms), "قبل 59 دقيقة");
});

test("Arabic time-ago: 1 يوم -> منذ يوم, 2 -> منذ يومين, 3..10 -> منذ N أيام, 11+ -> منذ N يومًا", () => {
  const forms = arTime();
  const now = Date.parse("2026-09-06T00:00:00Z");
  assert.equal(formatTimeAgo(now - 1 * 24 * 60 * 60_000, now, forms), "منذ يوم");
  assert.equal(formatTimeAgo(now - 2 * 24 * 60 * 60_000, now, forms), "منذ يومين");
  assert.equal(formatTimeAgo(now - 3 * 24 * 60 * 60_000, now, forms), "منذ 3 أيام");
  assert.equal(formatTimeAgo(now - 10 * 24 * 60 * 60_000, now, forms), "منذ 10 أيام");
  assert.equal(formatTimeAgo(now - 11 * 24 * 60 * 60_000, now, forms), "منذ 11 يومًا");
  assert.equal(formatTimeAgo(now - 12 * 24 * 60 * 60_000, now, forms), "منذ 12 يومًا");
});

/* ----------------------------------------------------------------------------
   Legacy-row and Arabic tanween regression tests.
   Legacy RPC rows (written before the subject_id/kind migrations) carry both
   subject_id = NULL and kind = NULL. The read RPC hides legacy summary/exam
   events that can no longer resolve a parent subject name (they would render
   «بدون عنوان»), while keeping subject-self events that snapshot their own
   title. These tests pin (a) the mapper contract for such rows and (b) the
   Unicode correctness of the Arabic tanween al-fath (ملخصًا = فتحة مضاعفة
   BEFORE الألف) used in the templates and dictionary copy.
---------------------------------------------------------------------------- */

const FATHATAN = 0x064b; // ً
const ALEF = 0x0627; // ا

/* Every accusative tanween in the activity templates and dictionary copy must
   be the correct UTF-8 ordering (tanween, then alef) — i.e. «ملخصًا», never the
   common typo «ملخصاً» (alef, then tanween). */
test("Arabic tanween in ar.json activity templates uses the correct ملخصًا form", () => {
  const activity = readDict("ar").contributePage.activity;
  for (const key of ["summary", "deleteSummary"]) {
    const tmpl = activity[key];
    assert.ok(
      tmpl.includes("ملخصًا"),
      `activity.${key} contains «ملخصًا» (correct tanween) — got: ${tmpl}`
    );
    // The correct ordering is tanween IMMEDIATELY followed by alef.
    const idx = tmpl.indexOf("ملخصًا");
    assert.equal(tmpl.charCodeAt(idx + 4), FATHATAN, `${key}: tanween at the right slot`);
    assert.equal(tmpl.charCodeAt(idx + 5), ALEF, `${key}: alef after tanween`);
    assert.ok(
      !tmpl.includes("ملخصاً"),
      `activity.${key} must not use the wrong «ملخصاً» ordering`
    );
  }
});

test("Arabic tanween in ar.json day time-ago uses the correct يومًا form", () => {
  const other = readDict("ar").contributePage.activity.time.day.other;
  assert.ok(other.includes("يومًا"), `day.other uses «يومًا» — got: ${other}`);
  const idx = other.indexOf("يومًا");
  assert.equal(other.charCodeAt(idx + 3), FATHATAN, "tanween before alef");
  assert.equal(other.charCodeAt(idx + 4), ALEF, "alef after tanween");
});

test("subjectsSubtitle uses the correct ملخصًا (not ملخصاً)", () => {
  const subtitle = readDict("ar").contributePage.subjectsSubtitle;
  assert.ok(subtitle.includes("ملخصًا"), "subjectsSubtitle uses «ملخصًا»");
  assert.ok(!subtitle.includes("ملخصاً"), "subjectsSubtitle has no wrong «ملخصاً»");
  const idx = subtitle.indexOf("ملخصًا");
  assert.equal(subtitle.charCodeAt(idx + 4), FATHATAN, "tanween before alef");
  assert.equal(subtitle.charCodeAt(idx + 5), ALEF, "alef after tanween");
});

/* The whole Arabic dictionary must be free of the alef-then-tanween typo for
   these accusative nouns. */
test("no wrong alef-then-tanween «ملخصاً» in the Arabic dictionary", () => {
  const raw = readFileSync(resolve(dictionariesDir, "ar.json"), "utf8");
  assert.ok(
    !raw.includes("ملخصاً"),
    "no «ملخصاً» (wrong ordering) anywhere in ar.json"
  );
  assert.ok(
    raw.includes("ملخصًا"),
    "«ملخصًا» (correct ordering) is present in ar.json"
  );
});

/* Legacy summary/exam rows carry no subject reference (subject_id = NULL) and
   no kind, so they cannot resolve a parent subject name. The READ RPC hides
   these rows at the data source. The pure mapper, given only what the RPC
   returns, must surface a row without inventing a name (hiding is the data
   source's job — never a React name heuristic). */
test("legacy summary/exam create row with no parent subject maps without a name (hiding is data-source)", () => {
  const legacySummary = toActivityEvents(
    [
      row({
        action: "summary",
        kind: null,
        subject_name_en: null,
        subject_name_ar: null,
        title_en: "Ch 1 notes",
        title_ar: "ملخص الفصل الأول",
      }),
    ],
    { lang: "ar", now: NOW }
  )[0];
  assert.equal(legacySummary.kind, "summary");
  assert.equal(legacySummary.subjectName, undefined, "no parent subject name to resolve");

  const legacyExam = toActivityEvents(
    [
      row({
        action: "exam",
        kind: null,
        subject_name_en: null,
        subject_name_ar: null,
        exam_type: "final",
        title_en: null,
        title_ar: null,
      }),
    ],
    { lang: "ar", now: NOW }
  )[0];
  assert.equal(legacyExam.kind, "exam");
  assert.equal(legacyExam.subjectName, undefined, "no parent subject name to resolve");
});

/* When the data source has already hidden every legacy child row, the feed is
   simply empty — the mapper must not resurrect those rows. */
test("a fully-hidden legacy feed renders empty (no resurrection)", () => {
  const feed = toActivityEvents([], { lang: "ar", now: NOW });
  assert.deepEqual(feed, [], "no rows in, no rows out");
});

/* Legacy subject-self rows (action = subject / edit / delete) carry a
   SNAPSHOTTED title, so their wording must use that title and NEVER fall back
   to «بدون عنوان» — even when there is no joinable parent subject. */
test("legacy subject/edit/delete rows word from the snapshot title, never «بدون عنوان»", () => {
  const untitled = readDict("ar").contributePage.activity.untitled;
  const genericDelete = readDict("ar").contributePage.activity.delete;

  for (const action of ["subject", "edit", "delete"]) {
    const event = toActivityEvents(
      [
        row({
          action,
          kind: null,
          subject_name_en: null,
          subject_name_ar: null,
          title_en: null,
          title_ar: "أفكار",
        }),
      ],
      { lang: "ar", now: NOW }
    )[0];
    assert.equal(event.title, "أفكار", `${action}: snapshotted title kept`);
    if (action === "delete") {
      assert.ok(
        genericDelete.includes("{title}"),
        "generic delete words from {title}"
      );
    }
    assert.notEqual(event.title, undefined, `${action}: has a title`);
    assert.ok(!String(event.title).includes(untitled), `${action}: no «بدون عنوان»`);
    assert.ok(!String(event.title).includes("بدون"), `${action}: no generic label`);
  }
});

/* A modern kind='subject' deletion survives the subject being gone: it keeps
   its SNAPSHOTTED name and is tagged resourceKind = 'subject'. */
test("modern subject deletion survives with snapshotted name and resourceKind", () => {
  const ID = "5c4d0f3e-9b17-4c83-a2e6-8f1a2b3c4d77";
  const event = toActivityEvents(
    [
      row({
        id: ID,
        action: "delete",
        kind: "subject",
        title_en: "Network Basics",
        title_ar: "أساسيات الشبكات",
      }),
    ],
    { lang: "ar", now: NOW }
  )[0];
  assert.equal(event.resourceKind, "subject");
  assert.equal(event.title, "أساسيات الشبكات", "snapshot survives");
});
