// The plan-vs-reality loop (spec 3.4.1-3.4.2): each mismatch type, its evidence, and that unknown is never a mismatch.
// Scenarios 12 (no model), 13 (loop side), 14 and 15.
import test from "node:test";
import assert from "node:assert/strict";
import { planVsReality, deferral } from "../scripts/lib/curiosity/loop.mjs";
import { emptyLedger } from "../scripts/lib/curiosity/ledger.mjs";
import { aw } from "./fixtures/curiosity-aw.mjs";

globalThis.fetch = () => { throw new Error("no network or model in the loop (scenario 12)"); };

const T = (h, m = 0) => new Date(2026, 9, 16, h, m);
const m = (h, mm = 0) => h * 60 + mm;
const resume = { id: "b1", title: "finish resume", kind: "study", start: m(14), end: m(16), fixed: false, source: "orion" };
const run = (now, awOver, ctx = {}) => planVsReality(aw(now, awOver), { day: [resume], checkins: [], ledger: emptyLedger(), sent: {}, now, ...ctx });
const onNow = (b) => ({ calendar: { now: b } });

test("not started: 14:05, no session, no work app, no check-in gives one plan check-in for the block", () => {
  const out = run(T(14, 5), onNow(resume));
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].type, out[0].action, out[0].blockId], ["not-started", "checkin", "b1"]);
  assert.match(out[0].text, /Finish resume was down for 2 - not started yet\. What's up\?/);
});

test("not started: nothing before 5 minutes, and nothing once it is said (the check-in loop owns the follow-ups)", () => {
  assert.deepEqual(run(T(14, 3), onNow(resume)), []);
  assert.deepEqual(run(T(14, 6), onNow(resume), { sent: { "mismatch-not-started-b1-1": true } }), []);
  const loop = { id: "ci-1", block: "b1", loop: { phase: "reminded", level: 1 } };
  assert.deepEqual(run(T(14, 20), onNow(resume), { checkins: [loop] }), [], "one live loop per block");
});

test("not started: evidence that he is at it means no mismatch (session on the task, work app, the gym place, a log)", () => {
  assert.deepEqual(run(T(14, 6), { ...onNow(resume), session: { state: "focus", task: "the resume" } }), [], "a focus session on the task (deferral anyway)");
  assert.deepEqual(run(T(14, 6), { ...onNow(resume), mac: { workApp: "Pages" } }), []);
  const gym = { ...resume, id: "g1", title: "Gym", kind: "gym" };
  assert.equal(run(T(14, 6), { ...onNow(gym), location: { state: "known", placeId: "gym", since: T(13, 50).toISOString() } }, { day: [gym] }).length, 0);
  assert.equal(run(T(14, 6), onNow(gym), { day: [gym] })[0].type, "not-started", "same block, not at the gym");
  assert.deepEqual(run(T(14, 6), onNow(resume), { day: [resume, { id: "l", title: "library", kind: "study", start: m(13, 30), end: m(15), source: "orion", fixed: false, logged: true }] }), []);
});

test("not started: a loop whose block now has evidence is closed quietly", () => {
  const loop = { id: "ci-1", block: "b1", loop: { phase: "reminded", level: 1 } };
  const out = run(T(14, 12), { ...onNow(resume), mac: { workApp: "Pages" }, session: { state: "rest" } }, { checkins: [loop] });
  assert.deepEqual(out.map((a) => [a.type, a.action, a.checkinId]), [["close", "close", "ci-1"]]);
});

test("unknown is never a mismatch: an unreadable calendar, an unknown location and an unknown mac make no off-plan claim", () => {
  assert.deepEqual(run(T(14, 30), { calendar: { state: "unknown" } }), []);
  const unknown = { ...onNow(resume), location: { state: "unknown", placeId: null, homeKnown: true }, mac: { state: "unknown", workApp: null } };
  assert.deepEqual(run(T(14, 40), unknown).map((a) => a.type), [], "past the 30-minute window and nothing known: no off-plan");
  assert.equal(run(T(14, 8), unknown)[0].type, "not-started", "but a block with no possible evidence is still asked about once (spec 5)");
});

test("off-plan away (scenario 15): elsewhere 20 min during a home study block asks once, window = the block", () => {
  const away = { ...onNow(resume), location: { state: "elsewhere", placeId: null, cell: "51.53,-0.09", since: T(14, 10).toISOString() } };
  const out = run(T(14, 30), away);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "off-plan");
  assert.deepEqual(out[0].ask, { type: "mismatch", blockId: "b1", window: { date: "2026-10-16", start: m(14), end: m(16) } });
  assert.match(out[0].text, /is finish resume still happening, or did plans change/);
  assert.deepEqual(run(T(14, 30), away, { sent: { "mismatch-off-plan-b1-1": true } }), []);
  const fresh = { ...away, location: { ...away.location, since: T(14, 20).toISOString() } };
  assert.deepEqual(run(T(14, 30), fresh), [], "10 minutes away is not yet off-plan, and not 'not started' either");
});

test("should leave (scenario 14): a dinner with a 15:30 wall, atHome at 15:31 gives a plain leave-late; away gives nothing", () => {
  const dinner = { id: "d", title: "Dinner with friends", kind: "other", start: m(16), end: m(18), fixed: true, source: "calendar" };
  const travel = [{ title: "travel to dinner", start: m(15, 30), end: m(16) }];
  const home = planVsReality(aw(T(15, 31), { calendar: { travelNow: "travel to dinner" } }), { day: [dinner], travel, checkins: [], ledger: emptyLedger(), sent: {}, now: T(15, 31) });
  assert.equal(home.length, 1);
  assert.equal(home[0].key, `leave-late-${m(16)}`);
  assert.equal(home[0].type, "should-leave");
  assert.equal(home[0].urgentKind, undefined, "a dinner never cuts through focus or quiet hours");
  assert.notEqual(home[0].urgent, true);
  const gone = planVsReality(aw(T(15, 31), { location: { state: "elsewhere", placeId: null, homeKnown: true } }), { day: [dinner], travel, checkins: [], ledger: emptyLedger(), sent: {}, now: T(15, 31) });
  assert.deepEqual(gone, []);
  const unknownHome = planVsReality(aw(T(15, 31), { location: { state: "unknown", placeId: null, homeKnown: true } }), { day: [dinner], travel, checkins: [], ledger: emptyLedger(), sent: {}, now: T(15, 31) });
  assert.deepEqual(unknownHome, [], "unknown location is not 'still at home'");
});

test("should leave: a class keeps today's urgent rungs, and atHome true is the 'not left' evidence", () => {
  const cs = { id: "c1", title: "CS1800 Discrete Structures — Lecture", kind: "class", start: m(9), end: m(10, 30), fixed: true, source: "calendar" };
  const travel = [{ title: "commute to class", start: m(8, 15), end: m(9) }];
  const out = planVsReality(aw(T(8, 20)), { day: [cs], travel, checkins: [], ledger: emptyLedger(), sent: { [`leave-${m(9)}`]: true }, now: T(8, 20), signals: { leftAt: m(8, 10) } });
  assert.equal(out[0].key, `leave-late-${m(9)}`, "at home per awareness beats a stale leftAt");
  assert.equal(out[0].urgentKind, "class");
});

test("several mismatches: one per tick, the highest weight first", () => {
  const gym = { id: "g", title: "Gym", kind: "gym", start: m(14), end: m(15), fixed: false, source: "orion", rank: "must" };
  const todo = { id: "t", title: "email prof", kind: "other", start: m(14), end: m(14, 30), fixed: false, source: "orion", rank: "medium" };
  const out = planVsReality(aw(T(14, 10)), { day: [todo, gym], checkins: [], ledger: emptyLedger(), sent: {}, now: T(14, 10) });
  assert.deepEqual(out.map((a) => a.blockId), ["g"]);
});

test("deferral: focus, a pause under 3 minutes, sleep and class hold the loop (urgent ladder rungs still come)", () => {
  const now = T(14, 10);
  assert.equal(deferral(aw(now, { session: { state: "focus" } }), now), "focus");
  assert.equal(deferral(aw(now, { session: { state: "paused", since: T(14, 8).toISOString() } }), now), "pause");
  assert.equal(deferral(aw(now, { session: { state: "paused", since: T(14, 5).toISOString() } }), now), null);
  assert.equal(deferral(aw(now, { sleep: { state: "asleep" } }), now), "sleep");
  assert.equal(deferral(aw(now, { calendar: { now: { kind: "class" } } }), now), "class");
  assert.equal(deferral(aw(now, { session: { state: "rest" } }), now), null, "a break is when things come out");
  assert.deepEqual(run(now, { ...onNow(resume), session: { state: "focus", task: "something else" } }), []);
});
