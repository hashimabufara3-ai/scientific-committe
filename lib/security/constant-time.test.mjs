import { test } from "node:test";
import assert from "node:assert/strict";
import { constantTimeEqual } from "./constant-time.ts";

test("accepts the correct bearer secret", async () => {
  const secret = "my-super-secret-value";
  const ok = await constantTimeEqual(`Bearer ${secret}`, `Bearer ${secret}`);
  assert.equal(ok, true);
});

test("rejects an incorrect bearer secret", async () => {
  const ok = await constantTimeEqual("Bearer wrong", "Bearer correct");
  assert.equal(ok, false);
});

test("rejects empty string against expected", async () => {
  const ok = await constantTimeEqual("", "Bearer correct");
  assert.equal(ok, false);
});

test("rejects shorter supplied value", async () => {
  const ok = await constantTimeEqual("Bearer correc", "Bearer correct");
  assert.equal(ok, false);
});
