// Asking one of ORION's own questions at a good moment (wave 12 L1): at the Mac, free, awake, in hours, once a day.
import test from "node:test";
import assert from "node:assert/strict";
import { questionAsk, questionText, QUESTION_PREFIX } from "../scripts/lib/curiosity/question-ask.mjs";
import { emptyLedger } from "../scripts/lib/curiosity/ledger.mjs";
import { addQuestion, markAsked } from "../scripts/lib/brain/questions.mjs";

const at = (h, m = 0, d = 2) => new Date(2026, 10, d, h, m);
const free = () => ({
  sleep: { state: "awake", inWindow: false }, session: { state: "none" }, calendar: { state: "ok", now: null, travelNow: null },
  mac: { state: "active", idleSeconds: 20 }, routine: null, location: { state: "home" }, derived: { atHome: true },
});
const rows = addQuestion([], { q: "Who is Sam?", why: "he lifts with Sam", topic: "person" }, at(9)).rows;
const ctx = (over = {}) => ({ now: at(15), rows, ledger: emptyLedger(), turns: [], day: [], wakeGrace: false, otherAsk: false, ...over });

test("asks the next question when he is at the Mac and free", () => {
  const a = questionAsk(free(), ctx());
  assert.ok(a);
  assert.equal(a.action, "ask");
  assert.equal(a.kind, "question");
  assert.equal(a.questionId, rows[0].id);
  assert.equal(a.text, `${QUESTION_PREFIX}Who is Sam?`);
  assert.equal(a.ask.type, "question-note");
  assert.equal(a.key, `question-${rows[0].id}-2026-11-02`);
});

test("never when he is not interruptible", () => {
  const cases = {
    away: { ...free(), mac: { state: "idle", idleSeconds: 900 } },
    locked: { ...free(), mac: { state: "locked", idleSeconds: 5 } },
    focus: { ...free(), session: { state: "focus" } },
    class: { ...free(), calendar: { state: "ok", now: { kind: "class", title: "ECON" }, travelNow: null } },
    asleep: { ...free(), sleep: { state: "asleep", inWindow: true } },
    quiet: { ...free(), sleep: { state: "late-awake", inWindow: true } },
    routine: { ...free(), routine: { holdsAsks: true } },
  };
  for (const [name, aw] of Object.entries(cases)) assert.equal(questionAsk(aw, ctx()), null, name);
  assert.equal(questionAsk(free(), ctx({ now: at(23) })), null, "after hours");
  assert.equal(questionAsk(free(), ctx({ now: at(7) })), null, "before hours");
  assert.equal(questionAsk(free(), ctx({ wakeGrace: true })), null, "just woke");
  assert.equal(questionAsk(free(), ctx({ otherAsk: true })), null, "another ask this tick");
});

test("same caps as blank asks: not within the blank-ask gap", () => {
  const ledger = { ...emptyLedger(), asks: [{ type: "home-gap", key: "k", at: at(14, 40).toISOString(), answeredAt: null }] };
  assert.equal(questionAsk(free(), ctx({ ledger })), null);
});

test("once a day, and nothing when the queue is empty", () => {
  const asked = markAsked(rows, rows[0].id, { via: "push", text: "x" }, at(11));
  assert.equal(questionAsk(free(), ctx({ rows: asked })), null);
  assert.equal(questionAsk(free(), ctx({ rows: [] })), null);
});

test("questionText is the words he sees", () => {
  assert.equal(questionText({ q: "Who is Sam?" }), "Question for you: Who is Sam?");
});
