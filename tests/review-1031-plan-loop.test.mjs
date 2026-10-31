// 2026-10-31 review of the proactive loop (findings 1, 2, 8, 10, 12). Pure: lib/reach/plan-loop.mjs and plan-ladder.mjs with
// fake effects and a fake clock. The reviewer's simulation: one ignored Gym block became 23 pushes, 4 replans, blocks shrunk to
// 5 min and the Gym deleted on the second ladder; the closing message named only the block itself.
import test from "node:test";
import assert from "node:assert/strict";
import { tickPlanLoop } from "../scripts/lib/reach/plan-loop.mjs";
import { replanFrom, endText, noteText } from "../scripts/lib/reach/plan-ladder.mjs";

const at = (h, m = 0) => new Date(2026, 9, 30, h, m).getTime();
const mins = (ms) => Math.floor(ms / 60000);
const GYM = { date: "2026-10-30", start: 1020, end: 1110 };   // 17:00-18:30
const loop = (over = {}) => ({ id: "ci-gym", what: "Gym", by: "orion", block: "cal-gym1", tier: "protected", blockWindow: GYM, alerts: 0, createdAt: new Date(at(17, 5)).toISOString(),
  loop: { phase: "waiting", level: 0, nextCheckAt: mins(at(17, 5)), history: [] }, ...over });
const ctx = (h, m, over = {}) => ({ nowMs: at(h, m), record: null, declared: [], patterns: null, slipsToday: [], workouts: [], sentToday: [], ...over });
const DISPLACE_OUT = [
  "Changed Friday 2026-10-30:",
  "  Gym 17:00–18:30 will not happen (gave-up); it is off its slot",
  "  re-entered Gym: 21:20–22:50",
  "  moved Study for CS Midterm: 20:15 → 19:00",
  "  bumped Go over Orion learning plan (21:30–22:30): lower weight than what it made room for",
  "  practice leetcode has no room today",
  'Written to his calendar. "orion-reschedule undo" puts it back.',
].join("\n");
function fakes({ reached = true, stdout = DISPLACE_OUT } = {}) {
  const sent = [], displaced = [], outcomes = [], queued = [];
  return { sent, displaced, outcomes, queued,
    fx: { send: (c, msg) => { sent.push(msg); return { reached, dropped: false, channels: reached ? ["auto"] : [] }; },
      displace: (c) => { displaced.push(c.what); return { status: 0, stdout }; },
      outcome: (row) => outcomes.push(row), queue: (c, text) => queued.push(text) } };
}

test("finding 2: replanFrom reads every moved, bumped and no-room line, not only the re-entered block", () => {
  const r = replanFrom({ status: 0, stdout: DISPLACE_OUT }, "Gym");
  assert.equal(r.kind, "moved");
  assert.deepEqual(r.changes, [
    { type: "moved", title: "Study for CS Midterm", from: 1215, to: 1140 },
    { type: "bumped", title: "Go over Orion learning plan" },
    { type: "off", title: "practice leetcode" },
  ]);
});

test("finding 2: the closing message names every other block the replan touched", () => {
  const text = endText({ title: "Gym", start: 1020, replan: replanFrom({ status: 0, stdout: DISPLACE_OUT }, "Gym") });
  assert.match(text, /I've moved it to 9:20 PM–10:50 PM/);
  assert.match(text, /Study for CS Midterm.*7:00 PM/);
  assert.match(text, /Go over Orion learning plan/);
  assert.match(text, /practice leetcode/);
});

test("finding 2: the queued 'what changed' line names the moves and carries no running count", () => {
  const text = noteText({ title: "Gym", replan: replanFrom({ status: 0, stdout: DISPLACE_OUT }, "Gym") });
  assert.match(text, /Gym.*9:20 PM/); assert.match(text, /Study for CS Midterm/); assert.match(text, /Go over Orion learning plan/);
  assert.doesNotMatch(text, /\b\d+ min\b/, "a held line with 'N min' in it is thrown away as perishable");
});

test("finding 1: a title already re-planned today is never displaced again; its END asks instead", () => {
  const f = fakes();
  const c = loop({ id: "ci-gym2", alerts: 4, blockWindow: { date: "2026-10-30", start: 1280, end: 1370 }, loop: { phase: "intervening", level: 4, nextCheckAt: mins(at(22, 25)), history: [] } });
  const next = tickPlanLoop(c, ctx(22, 25, { replannedTitles: ["gym"] }), f.fx);
  assert.deepEqual(f.displaced, [], "the reviewer's run displaced Gym twice and deleted it the second time");
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].text, /^Gym didn't happen at 9:20 PM/);
  assert.match(f.sent[0].text, /\?/, "the second END is a question");
  assert.equal(next.ladder.resolution.status, "asked");
});

test("finding 1: a reprise loop (the re-entered block) is L0 then END-as-question, nothing in between", () => {
  const f = fakes();
  const W = { date: "2026-10-30", start: 1280, end: 1370 };   // 21:20-22:50
  let c = loop({ id: "ci-gym2", reprise: true, blockWindow: W, createdAt: new Date(at(21, 25)).toISOString(), loop: { phase: "waiting", level: 0, nextCheckAt: mins(at(21, 25)), history: [] } });
  for (let t = at(21, 25); t <= at(22, 50); t += 5 * 60000) c = tickPlanLoop(c, { ...ctx(0, 0), nowMs: t, replannedTitles: ["gym"] }, f.fx);
  assert.deepEqual(f.sent.map((m) => m.rung), [0, 4], f.sent.map((m) => m.text).join(" | "));
  assert.deepEqual(f.displaced, []);
  assert.match(f.sent[1].text, /\?/);
});

test("finding 1: one missed sample per title per day", () => {
  const f = fakes();
  const c = loop({ alerts: 4, loop: { phase: "intervening", level: 4, nextCheckAt: mins(at(18, 5)), history: [] } });
  const first = tickPlanLoop(c, ctx(18, 5), f.fx);
  assert.equal(f.outcomes.length, 1); assert.equal(first.ladder.sampled, true);
  const again = loop({ id: "ci-gym2", alerts: 4, blockWindow: { date: "2026-10-30", start: 1280, end: 1370 }, loop: { phase: "intervening", level: 4, nextCheckAt: mins(at(22, 25)), history: [] } });
  tickPlanLoop(again, ctx(22, 25, { replannedTitles: ["gym"], sampledTitles: ["gym"] }), f.fx);
  assert.equal(f.outcomes.length, 1, "the second miss of the same block is not a second sample");
});

test("finding 10: a declared skip with a real reason is not a missed sample; an excuse is", () => {
  const sick = fakes();
  const fact = (text) => [{ id: "f1", date: "2026-10-30", at: new Date(at(16)).toISOString(), kind: "skip", text, title: "Gym" }];
  const a = tickPlanLoop(loop(), ctx(17, 5, { declared: fact("skipping gym, I'm sick") }), sick.fx);
  assert.equal(a.ladder.resolution.status, "declared");
  assert.equal(sick.outcomes.length, 0);
  const lazy = fakes();
  tickPlanLoop(loop(), ctx(17, 5, { declared: fact("skipping gym today, can't be bothered") }), lazy.fx);
  assert.equal(lazy.outcomes.length, 1); assert.equal(lazy.outcomes[0].actualAt, null);
});

test("finding 8: END waits until a grace he was given is over", () => {
  const f = fakes();
  const c = loop({ alerts: 2, loop: { phase: "deferred", level: 2, nextCheckAt: mins(at(18, 45)), history: [] },
    ladder: { sent: [], graces: 1, grace: { at: new Date(at(18, 20)).toISOString(), until: new Date(at(18, 45)).toISOString(), reason: "eating", returning: "you ate" } } });
  const during = tickPlanLoop(c, ctx(18, 31), f.fx);   // the block ended at 18:30, the grace runs to 18:45
  assert.equal(f.sent.length, 0, "no closing message while he is eating");
  assert.deepEqual(f.displaced, []);
  tickPlanLoop(during, ctx(18, 46), f.fx);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].rung, 4);
});

test("finding 2: an END that never got through before it lapsed leaves a short 'what changed' line for the next open moment", () => {
  const f = fakes({ reached: false });
  let c = loop({ alerts: 4, loop: { phase: "intervening", level: 4, nextCheckAt: mins(at(18, 5)), history: [] } });
  c = tickPlanLoop(c, ctx(18, 5), f.fx);
  assert.equal(f.displaced.length, 1);
  c = tickPlanLoop(c, ctx(21, 40), f.fx);   // 190 min after the block ended: lapsed
  assert.equal(c.ladder.resolution.status, "lapsed");
  assert.equal(f.queued.length, 1);
  assert.match(f.queued[0], /Gym.*9:20 PM/);
});

test("finding 12: a started plan block gets one gentle 'still going?' at its planned end", () => {
  const f = fakes();
  let c = loop({ alerts: 1, loop: { phase: "active", level: 1, nextCheckAt: null, history: [] } });
  c = tickPlanLoop(c, ctx(18, 0), f.fx);
  assert.equal(f.sent.length, 0, "nothing while the block runs");
  c = tickPlanLoop(c, ctx(18, 31), f.fx);
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].text, /^Still going with Gym\?/);
  assert.ok(!f.sent[0].urgent);
  c = tickPlanLoop(c, ctx(18, 41), f.fx);
  assert.equal(f.sent.length, 1, "asked once");
});
