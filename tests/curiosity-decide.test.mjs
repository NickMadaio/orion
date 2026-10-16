// Blank asks (spec 3.4.2): the eligibility table and the choice of question. Scenarios 6, 7 and 12.
import test from "node:test";
import assert from "node:assert/strict";
import { blankAsk, fillBlankAsk } from "../scripts/lib/curiosity/decide.mjs";
import { emptyLedger, recordAsk } from "../scripts/lib/curiosity/ledger.mjs";
import { topTodo } from "../scripts/lib/curiosity/words.mjs";
import { aw } from "./fixtures/curiosity-aw.mjs";

globalThis.fetch = () => { throw new Error("no network or model (scenario 12)"); };

const T = (h, m = 0) => new Date(2026, 9, 16, h, m);
const m = (h, mm = 0) => h * 60 + mm;
const ask = (now, awOver, extra = {}) => blankAsk(aw(now, awOver), { minute: now.getHours() * 60 + now.getMinutes(), date: "2026-10-16", day: [], todos: [], ledger: emptyLedger(), now: now.getTime(), ...extra });
const gap = { calendar: { freeUntil: m(16), next: { title: "Gym", start: m(16) } } };

test("home gap (scenario 6): 14:00, nothing till 16:00, at home gives one ask with 'till 4'; the same gap asks no more", () => {
  const a = ask(T(14), gap, { day: [{ title: "Lunch", start: m(12), end: m(13) }, { title: "Gym", start: m(16), end: m(17) }] });
  assert.equal(a.type, "home-gap");
  assert.match(a.text, /Nothing planned till 4 - what are you up to\? Want me to put something there\?/);
  assert.equal(a.key, "home-gap-2026-10-16-780");
  assert.equal(a.ask.type, "home-gap");
  assert.deepEqual(a.ask.window, { date: "2026-10-16", start: m(13), end: null });
  const ledger = recordAsk(emptyLedger(), { askId: "a1", type: a.type, key: a.key, window: a.ask.window, at: T(14).toISOString() });
  assert.equal(ask(T(15, 5), gap, { ledger, day: [{ title: "Lunch", start: m(12), end: m(13) }] }), null, "same gap, and still inside the 60-minute spacing");
});

test("home gap names the top open to-do, and needs 30+ free minutes", () => {
  const todos = [{ title: "do cert courses", dueDate: "2026-10-30" }, { title: "finish resume", dueDate: "2026-10-17" }, { title: "waiting one", waiting: true }];
  assert.match(ask(T(14), gap, { todos }).text, /I could put finish resume there\.$/);
  assert.equal(ask(T(15, 45), { calendar: { freeUntil: m(16) } }), null);
});

test("away at an unknown cell (scenario 7): 25 min gives 'Where are you at?', 95 min at the same cell gives save-place, once", () => {
  const cell = "51.53,-0.09";
  const here = (since) => ({ location: { state: "elsewhere", placeId: null, cell, since: since.toISOString() } });
  const a = ask(T(15, 25), here(T(15)));
  assert.equal(a.type, "unknown-place");
  assert.equal(a.text, "Where are you at? I'll log it.");
  assert.equal(a.ask.cell, cell);
  let ledger = recordAsk(emptyLedger(), { askId: "u1", type: a.type, key: a.key, window: a.ask.window, cell, at: T(15, 25).toISOString() });
  assert.equal(ask(T(15, 40), here(T(15)), { ledger }), null, "no repeat inside the stay");
  const s = ask(T(16, 35), here(T(15)), { ledger });
  assert.equal(s.type, "save-place");
  assert.match(s.text, /want me to save this spot/);
  ledger = recordAsk(ledger, { askId: "s1", type: s.type, key: s.key, cell, at: T(16, 35).toISOString() });
  assert.equal(ask(T(17, 40), here(T(15)), { ledger }), null, "once per cell");
});

test("save-place also on the third separate day at one cell", () => {
  const cell = "51.50,-0.12";
  let ledger = emptyLedger();
  for (const d of ["2026-10-13", "2026-10-14"]) ledger = recordAsk(ledger, { askId: d, type: "unknown-place", key: `x-${d}`, cell, answeredAt: `${d}T12:00:00Z`, outcome: "answered", at: `${d}T11:00:00Z` });
  const a = ask(T(15, 30), { location: { state: "elsewhere", cell, since: T(15, 5).toISOString() } }, { ledger });
  assert.equal(a.type, "save-place");
});

test("away at a known place asks with its name; a place he already named is not 'new'", () => {
  const a = ask(T(15, 30), { location: { state: "known", placeId: "gym", since: T(15, 5).toISOString() } });
  assert.equal(a.type, "away-gap");
  assert.equal(a.text, "At gym? I'll log it.");
  const cell = "51.53,-0.09";
  const ledger = recordAsk(emptyLedger(), { askId: "u", type: "unknown-place", key: "k", cell, answeredAt: T(9).toISOString(), outcome: "answered", at: T(9).toISOString() });
  assert.equal(ask(T(15, 30), { location: { state: "elsewhere", cell, since: T(15, 5).toISOString() } }, { ledger }).type, "away-gap");
});

test("eligibility: not asleep, not in a session or a break, not busy or travelling, calendar readable, 09:00 to 22:00, not paused", () => {
  const ok = ask(T(14), gap);
  assert.ok(ok);
  assert.equal(ask(T(14), { ...gap, sleep: { state: "late-awake", inWindow: true } }), null);
  assert.equal(ask(T(14), { ...gap, session: { state: "rest" } }), null, "a break is for resting");
  assert.equal(ask(T(14), { ...gap, session: { state: "focus" } }), null);
  assert.ok(ask(T(14), { ...gap, session: { state: "unknown" } }), "unknown session is not a session");
  assert.equal(ask(T(14), { ...gap, calendar: { ...gap.calendar, now: { title: "Lab" } } }), null);
  assert.equal(ask(T(14), { ...gap, calendar: { ...gap.calendar, travelNow: "commute" } }), null);
  assert.equal(ask(T(14), { calendar: { state: "unknown" } }), null, "an unreadable calendar is not a blank");
  assert.equal(ask(T(8, 30), gap), null);
  assert.equal(ask(T(22), gap), null);
  assert.equal(ask(T(14), gap, { ledger: { ...emptyLedger(), pausedUntil: T(15).toISOString() } }), null);
});

test("home unknown or away: no home-gap (it needs atHome === true)", () => {
  assert.equal(ask(T(14), { ...gap, location: { state: "unknown", placeId: null, homeKnown: true } }), null);
  assert.equal(ask(T(14), { ...gap, location: { state: "home", placeId: "home", homeKnown: false } }), null, "home not confirmed yet");
});

test("fill-blank (evening): the largest unanswered blank over 45 min, once, from 20:00 to bedtime minus 30", () => {
  const ctx = { minute: m(21), date: "2026-10-16", bed: m(23, 45), ledger: emptyLedger(), now: T(21).getTime(), blanks: [{ start: m(10), end: m(11) }, { start: m(14), end: m(16) }] };
  const f = fillBlankAsk(aw(T(21)), ctx);
  assert.equal(f.type, "fill-blank");
  assert.equal(f.text, "Quick one for tonight's review - what was 2 to 4? Gym, library, nothing?");
  assert.equal(fillBlankAsk(aw(T(19)), { ...ctx, minute: m(19) }), null);
  assert.equal(fillBlankAsk(aw(T(23, 30)), { ...ctx, minute: m(23, 30) }), null);
  assert.equal(fillBlankAsk(aw(T(21)), { ...ctx, blanks: [{ start: m(10), end: m(10, 40) }] }), null);
  const done = recordAsk(emptyLedger(), { askId: "f", type: "fill-blank", key: "fill-blank-2026-10-16", window: { date: "2026-10-16", start: 840, end: 960 }, at: T(20, 5).toISOString() });
  assert.equal(fillBlankAsk(aw(T(21)), { ...ctx, ledger: done }), null);
});

// The three incidents of the 2026-10-16 audit (finding 9) that the old "free until" question was written for.
test("incident 10-13 12:01: the commute ends the gap (never 'till 1:30'; 25 min before the departure is too short)", () => {
  const travel = [{ title: "commute to class", start: m(12, 45), end: m(13, 30) }];
  const next = { calendar: { freeUntil: m(13, 30) } };
  assert.equal(ask(T(12, 20), next, { travel }), null);
  assert.match(ask(T(12, 1), next, { travel }).text, /Nothing planned till 12:45 - /);
  assert.match(ask(T(10), next, { travel }).text, /Nothing planned till 12:45 - /);
});

test("no hard-coded 9 PM cap: with nothing planned it says so and names no time", () => {
  const a = ask(T(15), {});
  assert.match(a.text, /^Nothing else planned today - what are you up to\?/);
  assert.doesNotMatch(a.text, /9/);
});

test("priority: study and deadlines before a side project, a due date within 2 days first", () => {
  const todos = [{ title: "research backpacking stuff" }, { title: "study for macro" }, { title: "Get shaving cream" }];
  assert.equal(topTodo(todos, "2026-10-16").title, "study for macro");
  assert.equal(topTodo([...todos, { title: "submit essay", dueDate: "2026-10-17" }], "2026-10-16").title, "submit essay");
});
