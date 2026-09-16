/*
   Node test suite for the RFC 6266 / RFC 5987 Content-Disposition builder in
   lib/content/content-disposition.ts (Phase 3H).

   The production download route places the stored file_name into
   Content-Disposition. Arabic/Unicode names previously crashed Node's header
   validation (ERR_INVALID_CHAR -> HTTP 500). These tests assert:

     - the header value is ALWAYS pure ASCII (no raw non-ASCII bytes);
     - the ASCII fallback (`filename="..."`) is a valid quoted-string;
     - Unicode names additionally carry `filename*=UTF-8''<pct-encoded>` with
       correct RFC 5987 percent-encoding;
     - CR/LF and header-injection characters are stripped;
     - a safe alphanumeric extension is preserved on the fallback.

   Run with:
     node --test lib/content/content-disposition.test.mjs
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAsciiFallback,
  buildContentDisposition,
  buildExtendedFilename,
  sanitizeStoredName,
} from "./content-disposition.ts";

function assertAsciiOnly(value) {
  for (const ch of value) {
    assert.ok(ch.charCodeAt(0) <= 0x7f, `raw non-ASCII char in header value: ${ch}`);
  }
}

test("ASCII filename collapses to the single-parameter form", () => {
  const header = buildContentDisposition("Case-Note-2026.pdf");
  assert.equal(header, 'attachment; filename="Case-Note-2026.pdf"');
  assertAsciiOnly(header);
});

test("ASCII filename with spaces keeps a valid quoted-string", () => {
  const header = buildContentDisposition("my report file.pdf");
  assert.equal(header, 'attachment; filename="my report file.pdf"');
  assertAsciiOnly(header);
});

test("filename with extension preserves the alphanumeric extension", () => {
  const fallback = buildAsciiFallback("SUMMARY FINAL.PDF");
  assert.equal(fallback, "SUMMARY FINAL.PDF");
});

test("Arabic filename emits ASCII fallback + RFC 5987 extended name", () => {
  const name = "لقطة شاشة 2026-03-28 222639.png";
  const header = buildContentDisposition(name);
  assertAsciiOnly(header);
  /* Fallback: the leading Arabic placeholder run is stripped, readable numeric
     segment + extension survive. */
  assert.ok(
    header.startsWith('attachment; filename="2026-03-28 222639.png"; filename*=UTF-8\'\''),
    `unexpected header: ${header}`
  );
  assert.ok(header.includes("; filename*=UTF-8''"), "missing RFC 5987 filename*");
  /* UTF-8 bytes: ل D9 84, ق D9 82, ط D8 B7, ة D8 A9, ش D8 B4, ا D8 A7;
     spaces -> %20; ASCII digits/-/. kept raw. */
  assert.equal(
    header,
    "attachment; filename=\"2026-03-28 222639.png\"; filename*=UTF-8''" +
      "%D9%84%D9%82%D8%B7%D8%A9%20%D8%B4%D8%A7%D8%B4%D8%A9%202026-03-28%20222639.png",
    header
  );
});

test("mixed Arabic/Latin filename encodes both segments", () => {
  const name = "ملخص فيزياء Lecture 1.pdf";
  const header = buildContentDisposition(name);
  assertAsciiOnly(header);
  /* ASCII fallback keeps the Latin tail readable. */
  assert.ok(header.includes('filename="Lecture 1.pdf"'), header);
  assert.ok(header.includes("filename*=UTF-8''"), header);
  /* UTF-8 bytes of "ملخص": D9 85 D9 84 D8 AE D8 B5. */
  assert.ok(header.includes("%D9%85%D9%84%D8%AE%D8%B5"), header);
  /* UTF-8 bytes of "فيزياء": D9 81 D9 8A D8 B2 D9 8A D8 A7 D8 A1. */
  assert.ok(header.includes("%D9%81%D9%8A%D8%B2%D9%8A%D8%A7%D8%A1"), header);
});

test("quotes are stripped and never appear in the header value", () => {
  const header = buildContentDisposition('a"b"c.pdf');
  assert.equal(header.includes('"'), true); // only the two quoting params
  assert.equal(/filename="([^"]*)"/.exec(header)?.[1] ?? "", "abc.pdf");
  assert.equal(header.includes("abc.pdf"), true);
  assertAsciiOnly(header);
});

test("CR/LF and Unicode line separators are stripped (header injection)", () => {
  const injected = "file\r\nX-Injected: 1\nلقطة.txt";
  const header = buildContentDisposition(injected);
  assert.equal(header.includes("\r"), false, "CR must be gone");
  assert.equal(header.includes("\n"), false, "LF must be gone");
  assert.equal(header.includes("\u2028"), false, "U+2028 must be gone");
  assert.equal(header.includes("\u2029"), false, "U+2029 must be gone");
  assertAsciiOnly(header);
});

test("backslash and path separators never reach the fallback", () => {
  const header = buildContentDisposition("..\\..\\etc\\passwd.pdf");
  assertAsciiOnly(header);
  assert.equal(header.includes("\\"), false, "backslash must be encoded/stripped");
  const fallbackMatch = /filename="([^"]*)"/.exec(header);
  assert.ok(fallbackMatch, "fallback present");
  assert.equal(/[/\\]/.test(fallbackMatch[1]), false, "fallback has no path separators");
});

test("Unicode outside Latin-1 (CJK) still yields ASCII-only header", () => {
  const name = "报告_最终版.pdf";
  const header = buildContentDisposition(name);
  assertAsciiOnly(header);
  assert.ok(header.includes("; filename*=UTF-8''"), "must include extended name");
  assert.ok(header.endsWith(".pdf"), header);
});

test("sanitizeStoredName strips injection characters and falls back safely", () => {
  assert.equal(sanitizeStoredName("file\r\n.pdf"), "file.pdf");
  assert.equal(sanitizeStoredName("\"\""), "download");
  assert.equal(sanitizeStoredName(null), "download");
  assert.equal(sanitizeStoredName(undefined), "download");
  assert.equal(sanitizeStoredName(""), "download");
});

test("buildExtendedFilename percent-encodes UTF-8 bytes correctly (RFC 5987)", () => {
  /* ل -> D9 84, ق -> D9 82, ط -> D8 B7, ة -> D8 A9 */
  assert.equal(
    buildExtendedFilename("لقطة"),
    "UTF-8''%D9%84%D9%82%D8%B7%D8%A9"
  );
  /* Leading/trailing whitespace is trimmed during sanitization. */
  assert.equal(buildExtendedFilename(" لقطة "), "UTF-8''%D9%84%D9%82%D8%B7%D8%A9");
  /* Pure ASCII letters/digits are emitted unencoded. */
  assert.equal(buildExtendedFilename("aBz09"), "UTF-8''aBz09");
  assert.equal(buildExtendedFilename("my report.pdf"), "UTF-8''my%20report.pdf");
});

test("RFC 5987 attr-char set is encoded exactly (no stray percent over-encoding)", () => {
  /* attr-char: ALPHA/DIGIT and ! # $ & + - . ^ _ ` | ~ are left unencoded. */
  assert.equal(
    buildExtendedFilename("a!#$&+-.^_`|~z"),
    "UTF-8''a!#$&+-.^_`|~z"
  );
  /* Characters outside attr-char (%, spaces, controls) are encoded. Quotes and
     the backslash are stripped outright by sanitization. */
  assert.equal(buildExtendedFilename("100%"), "UTF-8''100%25");
  assert.equal(buildExtendedFilename('a"b'), "UTF-8''ab");
  assert.equal(buildExtendedFilename("a b"), "UTF-8''a%20b");
});

test("buildContentDisposition never emits raw non-ASCII for a broad corpus", () => {
  const names = [
    "Case-Note-2026.pdf",
    "لقطة شاشة 2026-03-28 222639.png",
    "ملخص فيزياء 1.pdf",
    "报告_最终版.pdf",
    "emoji 🎓 final.pdf",
    "file\r\ninjection.pdf",
    "quote\"test.pdf",
    "a b c.pdf",
    "100%.pdf",
    "semi;colon.pdf",
    "شرطة-ومسافة ٠١٢٣.pdf",
  ];
  for (const name of names) {
    const header = buildContentDisposition(name);
    assertAsciiOnly(header);
    assert.equal(header.includes("\r"), false, `${name}: CR present`);
    assert.equal(header.includes("\n"), false, `${name}: LF present`);
  }
});