import { strict as assert } from "node:assert";
import { test } from "node:test";
import { lintReply, fixReply, clock12, RULES } from "../scripts/lib/remote/reply-lint.mjs";

test("flags tool narration from the 29 September runs", () => {
  const r1 = lintReply("The script *does* print location when the event has one");
  assert.ok(r1.some((f) => f.rule === "meta_talk"), "should flag 'script'");

  const r2 = lintReply("No relevant tool — nothing in the catalog reads Keychain");
  assert.ok(r2.some((f) => f.rule === "meta_talk"), "should flag 'catalog' or 'no tool'");

  const r3 = lintReply("You were right, I did have the tool — messages_send resolves Mom");
  assert.ok(r3.some((f) => f.rule === "meta_talk"), "should flag 'you were right, i did have' or 'the tool'");
});

test("a plain answer is clean", () => {
  const r = lintReply("Your next class is tomorrow at 9 AM: CS1802 in Portsoken 802.");
  assert.deepStrictEqual(r, []);
});

test("24-hour times are flagged and 12-hour ones are not", () => {
  const r1 = lintReply("I'll reach you at 20:46");
  assert.ok(r1.some((f) => f.rule === "time_24h"), "should flag 20:46");

  const r2 = lintReply("Class at 9:05 tomorrow");
  assert.ok(!r2.some((f) => f.rule === "time_24h"), "should not flag 9:05");

  const r3 = lintReply("Bed by 11:45 PM");
  assert.ok(!r3.some((f) => f.rule === "time_24h"), "should not flag 11:45 PM");
});

test("mixed formats are flagged once each", () => {
  const r = lintReply("Just past 8 PM—20:11.");
  assert.ok(r.some((f) => f.rule === "time_24h"), "should flag time_24h");
  assert.ok(r.some((f) => f.rule === "time_both"), "should flag time_both");
});

test("fixReply collapses mixed times", () => {
  const r = fixReply("It's 20:32 GMT+1 (8:32 PM).");
  assert.strictEqual(r.text, "It's 8:32 PM.");
  assert.ok(r.changed.includes("time_24h"));
});

test("fixReply rewrites a lone 24-hour time", () => {
  const r = fixReply("I'll check back at 20:56.");
  assert.strictEqual(r.text, "I'll check back at 8:56 PM.");
});

test("spoken replies flag markdown and length", () => {
  const mdText = "**This week:**\n- Wed: seminar";
  const r1 = lintReply(mdText, { spoken: true });
  assert.ok(r1.some((f) => f.rule === "markdown_spoken"), "should flag markdown_spoken");

  const longText = "x".repeat(400);
  const r2 = lintReply(longText, { spoken: true });
  assert.ok(r2.some((f) => f.rule === "too_long_spoken"), "should flag too_long_spoken");

  const r3 = lintReply(mdText, { spoken: false });
  assert.ok(!r3.some((f) => f.rule === "markdown_spoken"), "should not flag markdown when !spoken");

  const r4 = lintReply(longText, { spoken: false });
  assert.ok(!r4.some((f) => f.rule === "too_long_spoken"), "should not flag length when !spoken");
});

test("fixReply strips markdown when spoken", () => {
  const r = fixReply("**This week:** three classes", { spoken: true });
  assert.strictEqual(r.text, "This week: three classes");
});

test("repeated sentences are flagged and fixed", () => {
  const text = "No umbrella needed. It is clear. No umbrella needed.";
  const r1 = lintReply(text);
  assert.ok(r1.some((f) => f.rule === "repeated_sentence"), "should flag repeated_sentence");

  const r2 = fixReply(text);
  assert.strictEqual(r2.text, "No umbrella needed. It is clear.");
});

test("clock12 covers midnight and noon", () => {
  assert.strictEqual(clock12(0, 5), "12:05 AM");
  assert.strictEqual(clock12(12, 0), "12:00 PM");
  assert.strictEqual(clock12(23, 59), "11:59 PM");
});

test("invalid input throws", () => {
  assert.throws(() => lintReply(42), TypeError);
});
