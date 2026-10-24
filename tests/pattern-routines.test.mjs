// Learned routines (lib/patterns): synthetic multi-week phone history, his words, and the hooks that use a routine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { learnFromEvidence, explain } from "../scripts/lib/patterns/run.mjs";
import { routineNow, routineWindowsFor } from "../scripts/lib/patterns/now.mjs";
import { routineAsk } from "../scripts/lib/patterns/ask.mjs";
import { recordAnswer, readAnswers, writeRoutines, noteStatement } from "../scripts/lib/patterns/store.mjs";
import { routineFacet } from "../scripts/lib/patterns/hooks.mjs";
import { gate } from "../scripts/lib/reach/gate.mjs";
import { decide } from "../scripts/lib/reach/proactive.mjs";
import { actualDay, actualText } from "../scripts/lib/life/day-review.mjs";
import { blankBlocker } from "../scripts/lib/curiosity/decide.mjs";

const HOME = { lat: 51.528, lon: -0.087 }, CLUB = { lat: 51.498, lon: -0.099 };
const isHome = (f) => Math.abs(f.lat - HOME.lat) < 0.002 && Math.abs(f.lon - HOME.lon) < 0.002;
const iso = (date, hhmm, plusDays = 0) => { const d = new Date(`${date}T${hhmm}:00`); d.setDate(d.getDate() + plusDays); return d.toISOString(); };
const fix = (at, p, extra = {}) => ({ at, lat: p.lat, lon: p.lon, charging: false, motion: "still", ...extra });

/** A Friday out: home in the evening, at the club 23:00-03:00, home again 03:15. */
const nightOut = (date) => [fix(iso(date, "20:00"), HOME), fix(iso(date, "21:30"), HOME),
  ...["23:00", "23:30", "00:30", "01:30", "02:30"].map((t, i) => fix(iso(date, t, i ? 1 : 0), CLUB)), fix(iso(date, "03:15", 1), HOME)];
/** A night in: home all evening. */
const nightIn = (date) => ["20:00", "22:15", "23:30", "00:45", "02:00"].map((t, i) => fix(iso(date, t, i > 2 ? 1 : 0), HOME, { charging: i > 2 }));

const FRIDAYS = ["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23"];
const learn = (fixes, { now = new Date("2026-10-24T12:00:00"), messages = [], answers = [] } = {}) =>
  learnFromEvidence({ fixes, isHome, messages, answers }, { now }).routines.filter((r) => r.kind === "away-evening");

test("three Fridays out late: the Friday routine is learned, described from evidence, with its dates", () => {
  const [r, ...rest] = learn(FRIDAYS.slice(1).flatMap(nightOut), { now: new Date("2026-10-24T12:00:00") });
  assert.equal(rest.length, 0);
  assert.equal(r.status, "confident");
  assert.equal(r.weekdayName, "Friday");
  assert.equal(r.occurrences, 3);
  assert.equal(r.start, 23 * 60);
  assert.equal(r.end, 27 * 60 + 15);
  assert.equal(r.cell, "51.50,-0.10");
  assert.equal(r.label, "out Fri ~23:00–03:15, near 51.50,-0.10");   // never an invented name
  assert.equal(r.labelSource, "described");
  assert.deepEqual(r.evidence.map((e) => e.date), ["2026-10-09", "2026-10-16", "2026-10-23"]);
  assert.match(explain([r]), /2026-10-09 yes \(phone 23:00–03:15 51\.50,-0\.10\)/);
});

test("one Friday only: nothing is learned", () => {
  assert.deepEqual(learn(nightOut("2026-10-23")), []);
});

test("two Fridays: tentative, never used by the gate", () => {
  const [r] = learn(["2026-10-16", "2026-10-23"].flatMap(nightOut));
  assert.equal(r.status, "tentative");
  assert.equal(routineNow([r], { now: new Date("2026-10-30T23:30:00") }).state, "none");
});

test("a broken week lowers confidence; two in a row and it is no longer used", () => {
  const base = learn(["2026-10-02", "2026-10-09", "2026-10-16"].flatMap(nightOut), { now: new Date("2026-10-17T12:00:00") })[0];
  const once = learn([...["2026-10-02", "2026-10-09", "2026-10-16"].flatMap(nightOut), ...nightIn("2026-10-23")])[0];
  assert.ok(once.confidence < base.confidence, `${once.confidence} < ${base.confidence}`);
  assert.equal(once.misses, 1);
  const twice = learn([...["2026-10-02", "2026-10-09", "2026-10-16"].flatMap(nightOut), ...nightIn("2026-10-23"), ...nightIn("2026-10-30")], { now: new Date("2026-10-31T12:00:00") })[0];
  assert.ok(twice.confidence < once.confidence);
  assert.notEqual(twice.status, "confident");
});

test("a week with no data is unknown, never a break", () => {
  const r = learn(["2026-10-02", "2026-10-09", "2026-10-23"].flatMap(nightOut))[0];
  assert.equal(r.misses, 0);
  assert.equal(r.status, "confident");
});

test("his own word labels it: 'going out to the club'", () => {
  const messages = [{ at: iso("2026-10-16", "21:50"), text: "I'm going out to the club, unlock my phone" }];
  const [r] = learn(FRIDAYS.slice(1).flatMap(nightOut), { messages });
  assert.equal(r.label, "club");
  assert.equal(r.labelSource, "his words");
});

const confident = () => learn(FRIDAYS.slice(1).flatMap(nightOut))[0];

test("routineNow: before, in and the morning after a Friday; nothing on a Thursday", () => {
  const r = [confident()];
  const at = (s) => routineNow(r, { now: new Date(s) });
  assert.equal(at("2026-10-30T20:00:00").phase, "before");
  assert.equal(at("2026-10-30T20:00:00").holdsBedtime, false);
  assert.equal(at("2026-10-30T22:00:00").holdsBedtime, true);   // within 90 min of it
  assert.equal(at("2026-10-31T01:00:00").phase, "in");
  assert.equal(at("2026-10-31T01:00:00").holdsAsks, true);
  assert.equal(at("2026-10-31T10:00:00").state, "morning-after");
  assert.equal(at("2026-10-29T23:30:00").state, "none");
});

test("he answers 'nah staying in': refuted for that night, and logged as evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "routines-"));
  const r = confident();
  writeRoutines(dir, { routines: [r], at: "x", sources: {} });
  const ask = routineAsk(routineNow([r], { now: new Date("2026-10-30T20:00:00") }), { now: new Date("2026-10-30T20:00:00") });
  assert.equal(ask.text, "Out tonight like usual Fridays?");
  recordAnswer(dir, { ask: ask.ask, text: "nah staying in", now: new Date("2026-10-30T20:05:00") });
  assert.deepEqual(readAnswers(dir).map((a) => [a.evening, a.verdict]), [["2026-10-30", "refute"]]);
  const tonight = routineFacet({ dir, now: new Date("2026-10-30T23:30:00") });
  assert.equal(tonight.state, "refuted");
  assert.equal(tonight.holdsBedtime, false);
  assert.deepEqual(routineWindowsFor([r], "2026-10-30", { answers: readAnswers(dir) }), []);
  // the next Friday is untouched
  assert.equal(routineFacet({ dir, now: new Date("2026-11-06T23:30:00") }).state, "expected");
  // and the next learn counts it as a broken week
  const after = learn(FRIDAYS.slice(1).flatMap(nightOut), { now: new Date("2026-10-31T12:00:00"), answers: readAnswers(dir) })[0];
  assert.equal(after.misses, 1);
});

test("the routine ask is asked once, early, and not when he already said yes", () => {
  const r = [confident()];
  const now = new Date("2026-10-30T20:00:00");
  const state = routineNow(r, { now });
  assert.ok(routineAsk(state, { now }));
  assert.equal(routineAsk(state, { now, ledger: { asks: [{ type: "routine-check", window: { date: "2026-10-30" } }] } }), null);
  assert.equal(routineAsk(routineNow(r, { now: new Date("2026-10-30T22:30:00") }), { now: new Date("2026-10-30T22:30:00") }), null);
  assert.equal(routineAsk(routineNow(r, { now, answers: [{ evening: "2026-10-30", verdict: "confirm", at: now.toISOString() }] }), { now }), null);
});

test("saying 'staying in tonight' on his own refutes the night too", () => {
  const dir = mkdtempSync(join(tmpdir(), "routines-"));
  writeRoutines(dir, { routines: [confident()], at: "x", sources: {} });
  noteStatement(dir, { text: "staying in tonight, too tired", now: new Date("2026-10-30T19:00:00") });
  assert.equal(routineFacet({ dir, now: new Date("2026-10-30T23:30:00") }).state, "refuted");
});

test("fresh evidence of him at home an hour into it ends the hold", () => {
  const s = routineNow([confident()], { now: new Date("2026-10-31T00:30:00"), location: { state: "home" } });
  assert.equal(s.state, "home-instead");
  assert.equal(s.holdsBedtime, false);
});

test("the gate holds the bedtime nag during the routine (and only then)", () => {
  const routine = routineNow([confident()], { now: new Date("2026-10-30T23:45:00") });
  const aw = { sleep: { state: "awake" }, session: { state: "none" }, routine };
  const t = Date.parse("2026-10-30T23:45:00");
  assert.equal(gate(aw, { kind: "reminder", why: "proactive: bed-wind", now: t }).heldFor, "routine");
  assert.equal(gate(aw, { kind: "reminder", why: "proactive: bed-late", now: t }).heldFor, "routine");
  assert.equal(gate(aw, { kind: "reminder", why: "proactive: bed-wind", urgentKind: "reminder", now: t }).action, "deliver");   // one he set
  assert.equal(gate({ ...aw, routine: routineNow([confident()], { now: new Date("2026-10-29T23:45:00") }) }, { kind: "reminder", why: "proactive: bed-wind" }).action, "deliver");
  // the bedtime line itself is still composed; the gate is what keeps it from him
  const lines = decide({ minute: 23 * 60 + 20, bed: "23:45", wake: "08:00", day: [], sent: {} });
  assert.ok(lines.some((l) => l.key === "bed-wind" && l.kind === "reminder"));
});

test("no blank asks about where he is while he is out on his usual night", () => {
  const routine = routineNow([confident()], { now: new Date("2026-10-30T23:45:00") });
  const aw = { sleep: { state: "awake", inWindow: false }, session: { state: "none" }, calendar: { state: "ok" }, routine };
  assert.equal(blankBlocker(aw, { minute: 1425, ledger: { asks: [] }, now: Date.parse("2026-10-30T23:45:00"), to: 24 * 60 }), "routine");
});

test("the day review counts a routine stretch as known, not as a blank", () => {
  const evening = { ...confident(), start: 19 * 60, end: 23 * 60, label: "club" };
  const windows = routineWindowsFor([evening], "2026-10-30");
  const now = { date: "2026-10-30", minute: 22 * 60 };
  const without = actualDay({ blocks: [], now });
  assert.ok(without.blank.some((b) => b.start < 20 * 60 && b.end > 20 * 60));
  const withIt = actualDay({ blocks: [], routines: windows, now });
  assert.ok(!withIt.blank.some((b) => b.end > 19 * 60));
  assert.match(actualText(withIt), /club 7-10 \(as usual\)/);
});

test("the scheduler walls off a confident routine window, unless something already sits there", async () => {
  const { routineWalls } = await import("../scripts/lib/patterns/hooks.mjs");
  const dir = mkdtempSync(join(tmpdir(), "routines-"));
  writeRoutines(dir, { routines: [{ ...confident(), start: 19 * 60, end: 23 * 60, label: "club" }], at: "x", sources: {} });
  assert.deepEqual(routineWalls({ dir, date: "2026-10-30" }), [{ start: 1140, end: 1380, title: "usual club" }]);
  assert.deepEqual(routineWalls({ dir, date: "2026-10-30", existing: [{ start: 1200, end: 1260 }] }), []);
  assert.deepEqual(routineWalls({ dir, date: "2026-10-29" }), []);
});

test("during the routine a leave reminder still goes out (and the protected leave-late one), nothing queued for the morning", () => {
  const routine = routineNow([confident()], { now: new Date("2026-10-30T23:45:00") });
  const aw = { sleep: { state: "awake" }, session: { state: "none" }, routine };
  const t = Date.parse("2026-10-30T23:45:00");
  assert.equal(routine.holdsBedtime, true);
  assert.deepEqual(gate(aw, { kind: "reminder", why: "proactive: leave-1425", tier: "normal", now: t }).action, "deliver");
  assert.deepEqual(gate(aw, { kind: "reminder", why: "proactive: leave-late-1425", tier: "protected", now: t }).action, "deliver");
  assert.deepEqual(gate(aw, { kind: "reminder", why: "proactive: bed-wind", tier: "protected", now: t }).action, "deliver");
  assert.deepEqual(gate(aw, { kind: "checkin", why: "plan: gym", now: t }).action, "deliver");
});
