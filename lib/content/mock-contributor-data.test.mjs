/*
   Node test suite for authorName() — the pure helper behind "Added by"
   attribution in the contributor workspace, the summaries pages and the
   summary detail view. Unknown author ids must never leak an internal
   identifier (UUID, DB id, email, username) into user-facing text.

   The module under test is TypeScript; Node 24 type-strips the import (the
   file has no runtime dependencies and no value-level TS constructs).

   Run with:
     node --test lib/content/mock-contributor-data.test.mjs
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTHOR_NAMES,
  authorName,
  buildMyContributions,
} from "./mock-contributor-data.ts";

const UNKNOWN_ID = "460d7ae0-0f04-43f2-99b2-70bf2e7c5c69";

test("unknown author ids resolve to a localized generic label, never the id", () => {
  for (const id of [UNKNOWN_ID, "user-123", "me"]) {
    const en = authorName(id, "en");
    assert.equal(en, "A contributor", id);
    assert.ok(!en.includes(id), `EN must not leak ${id}`);
    const ar = authorName(id, "ar");
    assert.equal(ar, "أحد المساهمين", id);
    assert.ok(!ar.includes(id), `AR must not leak ${id}`);
  }
});

test("authorName never returns an empty or raw-identifier string", () => {
  for (const id of ["", " ", "460d7ae0-0f04-43f2-99b2-70bf2e7c5c69"]) {
    const en = authorName(id, "en");
    const ar = authorName(id, "ar");
    assert.ok(en.length > 0, `EN non-empty for ${JSON.stringify(id)}`);
    assert.ok(ar.length > 0, `AR non-empty for ${JSON.stringify(id)}`);
    assert.equal(
      en.includes("460d7ae0") || en === id,
      false,
      `EN has no id for ${JSON.stringify(id)}`
    );
    assert.equal(ar.includes("460d7ae0") || ar === id, false);
  }
});

test("known author names are preserved unchanged", () => {
  AUTHOR_NAMES["u-committee-1"] = { en: "Committee", ar: "اللجنة" };
  try {
    assert.equal(authorName("u-committee-1", "en"), "Committee");
    assert.equal(authorName("u-committee-1", "ar"), "اللجنة");
  } finally {
    delete AUTHOR_NAMES["u-committee-1"];
  }
});

test("an explicit localized fallback (dictionary wording) wins over the default", () => {
  assert.equal(authorName(UNKNOWN_ID, "en", "A contributor"), "A contributor");
  assert.equal(authorName(UNKNOWN_ID, "ar", "أحد المساهمين"), "أحد المساهمين");
  assert.equal(authorName(UNKNOWN_ID, "en", "Custom label"), "Custom label");
});

/* ---- buildMyContributions -------------------------------------------------
   The pure gate behind the server-scoped "My Contributions" panel: runs on
   the server (data-access.ts) over already author-scoped rows and re-asserts
   the ownership invariant. The browser only ever receives its output — no
   React-side ownership filtering exists. */

const VIEWER = "u-viewer-1";

function subject(id, overrides = {}) {
  return {
    id,
    title: `Subject ${id}`,
    authorId: VIEWER,
    createdAt: 0,
    summaries: [],
    exams: [],
    ...overrides,
  };
}
function summary(id, subjectId, overrides = {}) {
  return {
    id,
    subjectId,
    title: `Summary ${id}`,
    source: "content",
    videos: [],
    authorId: VIEWER,
    createdAt: 1,
    ...overrides,
  };
}
function exam(id, subjectId, overrides = {}) {
  return {
    id,
    subjectId,
    type: "midterm",
    fileName: `${id}.pdf`,
    authorId: VIEWER,
    createdAt: 2,
    ...overrides,
  };
}

function refs(entries) {
  return new Map(
    entries.map(([id, title]) => [id, { id, title }])
  );
}

test("buildMyContributions keeps only the viewer's own items and drops smuggled rows", () => {
  const items = buildMyContributions({
    ownedSubjects: [
      subject("s1"),
      subject("s2", { authorId: "u-other-1" }),
    ],
    summaries: [
      summary("sm1", "s2"),
      summary("sm2", "s2", { authorId: "u-other-1" }),
    ],
    exams: [
      exam("ex1", "s1"),
      exam("ex2", "s1", { authorId: "u-other-1" }),
    ],
    parentsBySubjectId: refs([
      ["s1", "Calculus"],
      ["s2", "Physics"],
    ]),
    viewerId: VIEWER,
  });

  // Owned subject (s1) + own summary in s2 + own exam in s1 — exactly three
  // items, newest first (exam 2 > summary 1 > subject 0).
  assert.deepEqual(
    items.map((i) => i.key),
    ["exam-ex1", "summary-sm1", "subject-s1"]
  );
  assert.ok(items.every((i) => i.authorId === VIEWER), "every item is the viewer's own");
  assert.ok(
    items.every((i) => !String(i.authorId).includes("u-other")),
    "no foreign author id ever surfaces"
  );
  // Subject items carry their full subject (child counts render from it).
  const subjectItem = items.find((i) => i.kind === "subject");
  assert.equal(subjectItem.kind, "subject");
  assert.equal(subjectItem.subject.id, "s1");
  // Summary/exam items carry the slim parent ref for the "in {subject}" line.
  const summaryItem = items.find((i) => i.kind === "summary");
  assert.equal(summaryItem.kind, "summary");
  assert.equal(summaryItem.subject.title, "Physics");
});

test("buildMyContributions drops a summary/exam whose parent subject is missing or inactive", () => {
  // Both children are the viewer's own, but their parent is not in the active
  // parents map — they must never surface.
  const items = buildMyContributions({
    ownedSubjects: [],
    summaries: [summary("sm1", "missing-parent")],
    exams: [exam("ex1", "missing-parent")],
    parentsBySubjectId: new Map(),
    viewerId: VIEWER,
  });
  assert.deepEqual(items, []);
});