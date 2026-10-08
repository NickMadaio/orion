// orion-v3-logs helpers: chat copies marked, follow-ups inherit their job,
// turns without a time are recognisable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { markDuplicates, assignJobs, count, hasTime } from "../scripts/lib/eval/v3/turns.mjs";

test("a chat message with a session twin within 3 minutes is marked as a copy", () => {
  const sessions = [{ file: "s", line: 5, userText: "lights off", at: "2026-10-08T21:00:01Z" }];
  const chats = [{ userText: "lights off", at: "2026-10-08T21:00:00Z" }, { userText: "lights off", at: "2026-10-08T22:00:00Z" }];
  const [a, b] = markDuplicates(sessions, chats);
  assert.equal(a.dupOf, "s:5");
  assert.equal(b.dupOf, undefined);
});

test("a quick follow-up in the same thread keeps the previous job; another thread does not", () => {
  const turns = [
    { file: "a", at: "2026-10-06T16:35:00Z", userText: "start a focus session for two hours" },
    { file: "a", at: "2026-10-06T16:36:00Z", userText: "Until eight PM." },
    { file: "b", at: "2026-10-06T16:36:30Z", userText: "Until eight PM." },
  ];
  assert.deepEqual(assignJobs(turns).map((t) => t.job), ["focus", "focus", "other"]);
});

test("count tallies by key; hasTime rejects missing or bad times", () => {
  assert.deepEqual(Object.fromEntries(count([{ c: "x" }, { c: "y" }, { c: "x" }], (o) => o.c)), { x: 2, y: 1 });
  assert.equal(hasTime({ at: "2026-10-08T21:00:00Z" }), true);
  assert.equal(hasTime({ at: undefined }), false);
  assert.equal(hasTime({ at: "not a date" }), false);
});
