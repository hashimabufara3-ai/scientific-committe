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