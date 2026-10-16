// Controls (spec 3.4.3): blank backoff 60/120/240 with no pause, reset by any answer, "not now" is not ignored,
// a mismatch is never backed off, the per-mismatch cooldown, and "stop asking". Scenario 8.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankGap, blankAllowed, recordAsk, closeAsk, markAnswered, readLedger, writeLedger, emptyLedger, isIgnored } from "../scripts/lib/curiosity/ledger.mjs";
import { planVsReality } from "../scripts/lib/curiosity/loop.mjs";
import { blankAsk } from "../scripts/lib/curiosity/decide.mjs";
import { aw } from "./fixtures/curiosity-aw.mjs";

const T = (h, m = 0) => new Date(2026, 9, 16, h, m).getTime();
const addAsk = (l, id, at, extra = {}) => recordAsk(l, { askId: id, type: "home-gap", key: `k-${id}`, at: new Date(at).toISOString(), ...extra });

test("blank backoff: two ignored asks give 120 then 240 minute gaps, no pause; an answer resets to 60", () => {
  let l = addAsk(emptyLedger(), "a1", T(10));
  assert.equal(blankGap(l, { now: T(10, 30) }), 60, "still pending, not yet ignored");
  assert.equal(blankGap(l, { now: T(11) }), 120, "ignored (no turn in 45 minutes)");
  assert.equal(blankAllowed(l, { now: T(11, 30) }), false);
  assert.equal(blankAllowed(l, { now: T(12, 1) }), true, "120 minutes after the first");
  l = addAsk(l, "a2", T(12, 1));
  assert.equal(blankGap(l, { now: T(13) }), 240);
  assert.equal(blankAllowed(l, { now: T(15, 30) }), false);
  assert.equal(blankAllowed(l, { now: T(16, 2) }), true, "never paused, only spaced");
  l = addAsk(l, "a3", T(16, 2));
  assert.equal(blankGap(l, { now: T(18) }), 240, "capped at 240");
  l = closeAsk(l, "a3", "answered", new Date(T(18)).toISOString());
  assert.equal(blankGap(l, { now: T(18, 5) }), 60, "any answer resets");
});

test("an inbound turn within 45 minutes means the ask was not ignored", () => {
  const l = addAsk(emptyLedger(), "a1", T(10));
  assert.equal(blankGap(l, { now: T(11), turns: [T(10, 20)] }), 60);
  assert.equal(isIgnored(l.asks[0], { now: T(11), turns: [T(10, 50)] }), true, "a turn after the 45-minute window does not rescue it");
});

test("'not now' is declined, not ignored; 'nothing' marks the blank answered", () => {
  let l = addAsk(emptyLedger(), "a1", T(10), { window: { date: "2026-10-16", start: 840, end: null } });
  l = closeAsk(l, "a1", "declined", new Date(T(10, 5)).toISOString());
  assert.equal(blankGap(l, { now: T(12) }), 60);
  assert.equal(l.asks[0].outcome, "declined");
  l = addAsk(l, "a2", T(12), { window: { date: "2026-10-16", start: 900, end: 960 } });
  l = closeAsk(l, "a2", "nothing", new Date(T(12, 2)).toISOString());
  assert.equal(l.asks[1].outcome, "nothing");
  assert.throws(() => closeAsk(l, "a2", "bogus"), /outcome must be one of/);
});

test("a logged block over the ask's window answers it", () => {
  const l = addAsk(emptyLedger(), "a1", T(15), { window: { date: "2026-10-16", start: 840, end: null } });
  const done = markAnswered(l, { logged: [{ start: 840, end: 960 }], date: "2026-10-16", now: T(16) });
  assert.equal(done.asks[0].outcome, "logged");
  assert.equal(markAnswered(l, { logged: [], date: "2026-10-16", now: T(16) }).asks[0].outcome, null);
});

test("the ledger round-trips through curiosity.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-led-"));
  assert.deepEqual(readLedger(dir), emptyLedger());
  writeLedger(dir, addAsk(emptyLedger(), "a1", T(10)));
  assert.equal(readLedger(dir).asks[0].askId, "a1");
});

test("a mismatch nudge is not delayed by the blank backoff", () => {
  const now = new Date(T(14, 10));
  let ledger = addAsk(addAsk(emptyLedger(), "a1", T(9, 30)), "a2", T(11, 40));
  assert.equal(blankGap(ledger, { now: now.getTime() }), 240);
  const resume = { id: "b1", title: "finish resume", kind: "study", start: 14 * 60, end: 16 * 60, fixed: false, source: "orion" };
  const out = planVsReality(aw(now, { calendar: { now: resume } }), { day: [resume], checkins: [], ledger, sent: {}, now });
  assert.equal(out[0].type, "not-started");
});

test("'stop asking' pauses blank asks (pausedUntil) but an open mismatch is unaffected", () => {
  const now = new Date(T(14, 10));
  const ledger = { ...emptyLedger(), pausedUntil: new Date(T(23)).toISOString() };
  const free = aw(now, { calendar: { freeUntil: 16 * 60 } });
  assert.equal(blankAsk(free, { minute: 850, date: "2026-10-16", day: [], todos: [], ledger, now: now.getTime() }), null);
  const resume = { id: "b1", title: "finish resume", kind: "study", start: 14 * 60, end: 16 * 60, fixed: false, source: "orion" };
  assert.equal(planVsReality(aw(now, { calendar: { now: resume } }), { day: [resume], checkins: [], ledger, sent: {}, now })[0].type, "not-started");
});

test("per-mismatch cooldown: one key per block per type; the loop adds nothing while its check-in is open", () => {
  const now = new Date(T(14, 40));
  const resume = { id: "b1", title: "finish resume", kind: "study", start: 14 * 60, end: 16 * 60, fixed: false, source: "orion" };
  const env = { day: [resume], ledger: emptyLedger(), now };
  const open = { id: "ci", block: "b1", loop: { phase: "intervening", level: 2 } };
  assert.deepEqual(planVsReality(aw(now, { calendar: { now: resume } }), { ...env, checkins: [open], sent: {} }), []);
  assert.deepEqual(planVsReality(aw(now, { calendar: { now: resume } }), { ...env, checkins: [], sent: { "mismatch-off-plan-b1-1": true } }).filter((a) => a.type === "off-plan"), []);
});
