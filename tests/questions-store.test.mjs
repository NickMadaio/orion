// The questions queue (wave 12 L1): what ORION wants to ask Nick, deduplicated, capped, and answered into memory.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addQuestion, answerQuestion, dropQuestion, editQuestion, markAsked, nextToAsk, openQuestions, resolveQuestion,
  sameQuestion, skipQuestion, OPEN_CAP, IGNORED_LIMIT,
} from "../scripts/lib/brain/questions.mjs";

const at = (h, m = 0, d = 2) => new Date(2026, 10, d, h, m);

test("add: a question gets an id, why, topic, priority and opens", () => {
  const { rows, added } = addQuestion([], { q: "Who is Priya?", why: "he mentioned her twice", topic: "person", priority: "high" }, at(10));
  assert.equal(rows.length, 1);
  assert.match(added.id, /^q-[0-9a-f]{6}$/);
  assert.equal(added.status, "open");
  assert.equal(added.by, "orion");
  assert.deepEqual([added.why, added.topic, added.priority], ["he mentioned her twice", "person", "high"]);
});

test("add: defaults, and rejects an empty or credential-shaped question", () => {
  const { added } = addQuestion([], { q: "  does he prefer gym mornings?  " }, at(10));
  assert.deepEqual([added.q, added.topic, added.priority], ["does he prefer gym mornings?", "other", "normal"]);
  assert.throws(() => addQuestion([], { q: "   " }, at(10)), /empty/);
  assert.throws(() => addQuestion([], { q: `what is the password ${"sk-"}${"x".repeat(20)}` }, at(10)), /secret/);   // built, so the secret scan sees no key
  assert.throws(() => addQuestion([], { q: "x?", priority: "urgent" }, at(10)), /priority/);
});

test("dedupe: a near-identical open question is not added twice", () => {
  assert.ok(sameQuestion("Who is Priya?", "who's priya"));
  assert.ok(sameQuestion("Does Nick prefer the gym in the morning?", "does he prefer gym in the mornings"));
  assert.ok(!sameQuestion("Who is Priya?", "Who is Sam?"));
  const first = addQuestion([], { q: "Who is Priya?" }, at(10));
  const again = addQuestion(first.rows, { q: "who's priya??" }, at(11));
  assert.equal(again.rows.length, 1);
  assert.equal(again.duplicate.id, first.added.id);
});

test("cap: at most OPEN_CAP open questions", () => {
  let rows = [];
  for (let i = 0; i < OPEN_CAP; i++) rows = addQuestion(rows, { q: `question number ${i} about thing${i}x` }, at(10, i)).rows;
  assert.equal(openQuestions(rows).length, OPEN_CAP);
  assert.throws(() => addQuestion(rows, { q: "one more about zebras" }, at(12)), /full/);
});

test("edit, drop, resolve never mutate the input", () => {
  const { rows, added } = addQuestion([], { q: "Who is Priya?" }, at(10));
  const frozen = JSON.stringify(rows);
  const edited = editQuestion(rows, added.id, { q: "Who is Priya to Nick?", priority: "low" }, at(11));
  assert.equal(edited.find((r) => r.id === added.id).q, "Who is Priya to Nick?");
  assert.equal(edited.find((r) => r.id === added.id).priority, "low");
  const dropped = dropQuestion(edited, added.id, "not needed", at(12));
  assert.equal(dropped[0].status, "dropped");
  const resolved = resolveQuestion(rows, added.id, "his lab partner (from the calendar)", at(12));
  assert.equal(resolved[0].status, "resolved");
  assert.equal(JSON.stringify(rows), frozen);
  assert.throws(() => editQuestion(rows, "q-000000", { q: "x" }, at(11)), /no question/);
});

test("answer: records the answer and the fact line to keep", () => {
  const { rows, added } = addQuestion([], { q: "Who is Priya?" }, at(10));
  const { rows: next, fact } = answerQuestion(rows, added.id, "my ds lab partner", at(15));
  const row = next[0];
  assert.equal(row.status, "answered");
  assert.equal(row.answer, "my ds lab partner");
  assert.equal(fact, "Who is Priya? → my ds lab partner");
  assert.throws(() => answerQuestion(next, added.id, "again", at(16)), /already answered/);
});

test("skip: an asked question opens again, its ask still counted, and today's ask is still spent", () => {
  const { rows, added } = addQuestion([], { q: "Who is Sam?" }, at(9));
  const asked = markAsked(rows, added.id, { via: "chat", text: "Who is Sam?" }, at(14));
  const skipped = skipQuestion(asked, added.id, at(14, 5));
  assert.equal(skipped[0].status, "open");
  assert.equal(skipped[0].askCount, 1);
  assert.equal(nextToAsk(skipped, at(18)), null);
  assert.throws(() => skipQuestion(dropQuestion(rows, added.id), added.id), /not open/);
});

test("next: highest priority, oldest first; never one asked today; ignored ones rest", () => {
  let rows = addQuestion([], { q: "low one about cats", priority: "low" }, at(9)).rows;
  rows = addQuestion(rows, { q: "normal one about dogs" }, at(10)).rows;
  rows = addQuestion(rows, { q: "high one about birds", priority: "high" }, at(11)).rows;
  const first = nextToAsk(rows, at(14));
  assert.equal(first.q, "high one about birds");
  // asked today: nothing else is asked today (one a day)
  const asked = markAsked(rows, first.id, { via: "push", text: `Question for you: ${first.q}` }, at(14));
  assert.equal(nextToAsk(asked, at(18)), null);
  // the next day, the unanswered one counts as ignored once and the next one up goes first
  const tomorrow = nextToAsk(asked, at(14, 0, 3));
  assert.equal(tomorrow.q, "normal one about dogs");
  // asked IGNORED_LIMIT times with no answer: it is not asked again (still listed)
  let r = rows;
  for (let i = 0; i < IGNORED_LIMIT; i++) r = markAsked(r, first.id, { via: "push", text: "x" }, at(14, 0, 3 + i));
  assert.ok(!nextToAsk(r, at(14, 0, 10)) || nextToAsk(r, at(14, 0, 10)).id !== first.id);
  assert.ok(openQuestions(r).some((q) => q.id === first.id));
});
