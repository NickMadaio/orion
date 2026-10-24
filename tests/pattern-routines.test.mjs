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
  ...["23:00", "23:30", "00:30", "01:30", "02:30"].map((t, i) => fix(iso(date, t, i > 1 ? 1 : 0), CLUB)), fix(iso(date, "03:15", 1), HOME)];
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
  assert.equal(at("2026-10-31T10:00:00").state, "none");   // no evidence the night happened: no morning grace
  assert.equal(routineNow(r, { now: new Date("2026-10-31T10:00:00"), nightHappened: () => true }).state, "morning-after");
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

test("the day review does not count a routine stretch as a blank, nor as done", () => {
  const evening = { ...confident(), start: 19 * 60, end: 23 * 60, label: "club" };
  const windows = routineWindowsFor([evening], "2026-10-30");
  const now = { date: "2026-10-30", minute: 22 * 60 };
  const without = actualDay({ blocks: [], now });
  assert.ok(without.blank.some((b) => b.start < 20 * 60 && b.end > 20 * 60));
  const withIt = actualDay({ blocks: [], routines: windows, now });
  assert.ok(!withIt.blank.some((b) => b.end > 19 * 60));
  assert.deepEqual(withIt.done, []);                       // an expectation, never a completion
  assert.doesNotMatch(actualText(withIt), /as usual|club/);
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

test("only going-out statements count for evenings; 'home tonight after the club' is not a no", async () => {
  const { parseStatement, verdictOf, statementEvidence } = await import("../scripts/lib/patterns/statements.mjs");
  assert.equal(parseStatement("I'm at the library").goingOut, false);
  assert.deepEqual(statementEvidence([{ at: iso("2026-10-16", "20:00"), text: "I'm at the library" }]), []);
  // the reviewer's probe: two "library" evenings plus one real night out learn nothing
  const msgs = ["2026-10-09", "2026-10-16"].map((d) => ({ at: iso(d, "20:00"), text: "I'm at the library" }));
  assert.deepEqual(learn(nightOut("2026-10-23"), { messages: msgs }), []);
  assert.notEqual(verdictOf("home tonight after the club"), "refute");
  assert.notEqual(parseStatement("home tonight after the club")?.polarity, -1);
  assert.equal(verdictOf("nah staying in"), "refute");
  assert.equal(verdictOf("yeah"), "confirm");
  assert.equal(verdictOf("going out, nah not tired"), "confirm");
});

test("calendar classes never become routines; a calendar event only corroborates a night out", async () => {
  const { learnRoutines } = await import("../scripts/lib/patterns/learn.mjs");
  const { nightOutEvents } = await import("../scripts/lib/patterns/sources.mjs");
  const acts = ["2026-10-05", "2026-10-12", "2026-10-19"].map((date) => ({ date, label: "cs2101", start: 540, end: 600, source: "calendar" }));
  const r = learnRoutines({ activities: acts, now: new Date("2026-10-24T12:00:00") });
  assert.deepEqual(r, []);
  assert.deepEqual(routineWindowsFor(r, "2026-10-26"), []);
  assert.deepEqual(nightOutEvents([{ date: "2026-10-23", title: "CS2101 Lab", start: 1080, end: 1200 }, { date: "2026-10-23", title: "Fabric club night", start: 1380, end: 1620 }]),
    [{ date: "2026-10-23", label: "club", start: 1380, end: 1620 }]);
  // three calendar "club" events and no phone/words: not a routine on their own
  const cal = ["2026-10-09", "2026-10-16", "2026-10-23"].map((date) => ({ date, label: "club", start: 1380, end: 1620 }));
  assert.deepEqual(learnFromEvidence({ fixes: [], isHome, corroborations: cal }, { now: new Date("2026-10-24T12:00:00") }).routines, []);
});

// The real shape of 9 Oct: away in the afternoon, nothing all evening, then two sparse away fixes at 01:31 and 01:49 Sat.
const sparseNight = (date) => [fix(iso(date, "13:12"), CLUB), fix(iso(date, "16:16"), CLUB),
  fix(iso(date, "01:31", 1), { lat: 51.518, lon: -0.08 }), fix(iso(date, "01:31", 1), { lat: 51.518, lon: -0.08 }), fix(iso(date, "01:49", 1), { lat: 51.518, lon: -0.08 })];

test("sparse night fixes (01:31-01:49 away, nothing else) still count as a night out", () => {
  const [r] = learn(["2026-10-09", "2026-10-16", "2026-10-23"].flatMap(sparseNight));
  assert.equal(r?.status, "confident");
  assert.equal(r.weekdayName, "Friday");
  assert.deepEqual(r.evidence.map((e) => e.via[0]), ["phone-sparse", "phone-sparse", "phone-sparse"]);
});

test("one drifted fix per Friday between home fixes learns nothing (the reviewer's stray-drift probe)", () => {
  const drift = { lat: 51.531, lon: -0.087 };
  const fixes = ["2026-10-09", "2026-10-16", "2026-10-23"].flatMap((d) => [fix(iso(d, "20:00"), HOME), fix(iso(d, "21:30"), drift), fix(iso(d, "23:00"), HOME), fix(iso(d, "23:30"), HOME)]);
  assert.deepEqual(learn(fixes), []);
});

test("one away fix counts only with corroboration: a late wake the next morning", () => {
  const fixes = ["2026-10-09", "2026-10-16", "2026-10-23"].flatMap((d) => [fix(iso(d, "20:00"), HOME), fix(iso(d, "23:40"), CLUB)]);
  assert.deepEqual(learn(fixes), []);
  const wakes = { "2026-10-10": 780, "2026-10-17": 800, "2026-10-24": 790, "2026-10-12": 540, "2026-10-13": 520, "2026-10-14": 530, "2026-10-15": 545 };
  const [r] = learnFromEvidence({ fixes, isHome, wakes }, { now: new Date("2026-10-24T12:00:00") }).routines;
  assert.equal(r?.status, "confident");
  assert.ok(r.evidence.every((e) => e.via.includes("late-wake")));
});

test("with no home known, a phone at the same place every night is home, not a routine (the no-home probe)", () => {
  const days = Array.from({ length: 21 }, (_, i) => { const d = new Date("2026-10-24T12:00:00"); d.setDate(d.getDate() - i - 1); return d.toLocaleDateString("en-CA"); });
  const fixes = days.flatMap((d) => ["19:00", "21:00", "23:00"].map((t) => fix(iso(d, t), HOME)));
  assert.deepEqual(learnFromEvidence({ fixes, isHome: () => false }, { now: new Date("2026-10-24T12:00:00") }).routines, []);
});

test("an away run starting after 01:00 right after he was at the Mac is drift (Wed 14 Oct '02:32-06:50')", () => {
  const nights = ["2026-10-07", "2026-10-14", "2026-10-21"];
  const fixes = nights.flatMap((d) => [fix(iso(d, "18:30"), HOME), ...["02:32", "03:51", "04:45", "06:50"].map((t) => fix(iso(d, t, 1), CLUB))]);
  const sessions = nights.map((d) => ({ start: iso(d, "21:23"), end: iso(d, "01:24", 1) }));
  assert.deepEqual(learnFromEvidence({ fixes, isHome, sessions }, { now: new Date("2026-10-24T12:00:00") }).routines, []);
  const asleep = learnFromEvidence({ fixes, isHome, sleeps: nights.map((d) => iso(d, "01:50", 1)) }, { now: new Date("2026-10-24T12:00:00") }).routines;
  assert.deepEqual(asleep, []);
});

test("different evenings on the same weekday are not averaged: a 17:30 dinner and a 23:00 club stay apart", () => {
  const early = (date) => [fix(iso(date, "17:00"), HOME), ...["17:30", "18:30", "19:30", "20:30", "21:30"].map((t) => fix(iso(date, t), CLUB)), fix(iso(date, "22:00"), HOME)];
  const rs = learn([...early("2026-10-02"), ...nightOut("2026-10-09"), ...nightOut("2026-10-16"), ...early("2026-10-23")]);
  assert.equal(rs[0].status, "tentative");          // two of each: neither shape has 3
  assert.equal(rs[0].occurrences, 2);
  assert.ok([17 * 60 + 30, 23 * 60].includes(rs[0].start));
  const three = learn([...early("2026-10-02"), ...FRIDAYS.slice(1).flatMap(nightOut)])[0];
  assert.equal(three.start, 23 * 60);               // the club cluster, not a median with the dinner
  assert.equal(three.occurrences, 3);
});

test("the morning-after grace needs the night to have happened: away fixes or his yes; a night in gets none", async () => {
  const { awayInWindow } = await import("../scripts/lib/patterns/hooks.mjs");
  const r = confident();
  const morning = new Date("2026-10-31T10:00:00");
  const out = awayInWindow(nightOut("2026-10-30"), isHome), stayed = awayInWindow(nightIn("2026-10-30"), isHome);
  assert.equal(routineNow([r], { now: morning, nightHappened: out }).state, "morning-after");
  assert.equal(routineNow([r], { now: morning, nightHappened: stayed }).state, "none");
  assert.equal(routineNow([r], { now: morning, answers: [{ evening: "2026-10-30", verdict: "confirm", at: "x" }] }).state, "morning-after");
  // a hooked-up controlled dir: the stayed-in night gives no grace
  const dir = mkdtempSync(join(tmpdir(), "routines-"));
  writeRoutines(dir, { routines: [r], at: "x", sources: {} });
  const signals = nightIn("2026-10-30").map((f) => ({ at: f.at, latitude: f.lat, longitude: f.lon, charging: f.charging, motion: f.motion }));
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ phoneSignals: signals }));
  writeFileSync(join(dir, "known-places.json"), JSON.stringify({ places: [{ id: "home", kind: "home", lat: HOME.lat, lon: HOME.lon, radiusM: 150 }] }));
  assert.equal(routineFacet({ dir, now: morning }).state, "none");
});

test("orion-daily runs the nightly learn quietly and briefly (stdio ignored, short timeout)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../scripts/orion-daily", import.meta.url), "utf8");
  const call = src.split("\n").find((l) => l.includes('"orion-patterns"'));
  assert.match(call, /stdio: "ignore"/);
  const ms = Number(call.match(/timeout: ([\d_]+)/)[1].replace(/_/g, ""));
  assert.ok(ms <= 60_000, `timeout ${ms}`);
});

test("the routine ask draws on the low-value budget, never the curiosity blank-ask budget or its spacing", async () => {
  const { tierOf } = await import("../scripts/lib/reach/budget.mjs");
  const { blankAllowed } = await import("../scripts/lib/curiosity/ledger.mjs");
  assert.equal(tierOf({ why: "curiosity: routine-check-2026-10-30", askType: "routine-check", kind: "question" }), "low");
  const now = Date.parse("2026-10-30T20:10:00");
  const ledger = { asks: [{ type: "routine-check", key: "routine-check-2026-10-30", at: "2026-10-30T20:00:00", window: { date: "2026-10-30" } }], blankGapMinutes: 60, pausedUntil: null };
  assert.equal(blankAllowed(ledger, { now }), true);
});

test("a gap in the data is not a night in: home 21:14 and 02:21 with nothing between is unknown (Fri 2 Oct)", async () => {
  const { eveningEpisodes, homeAllNight } = await import("../scripts/lib/patterns/episodes.mjs");
  const gap = eveningEpisodes([fix(iso("2026-10-02", "21:14"), HOME), fix(iso("2026-10-02", "02:21", 1), HOME)], { isHome });
  assert.equal(gap["2026-10-02"].status, "unknown");
  // the same night covered every 90 min is home; so is one covered by Mac use at home
  const covered = eveningEpisodes(["22:30", "23:50", "01:15", "02:30"].map((t, i) => fix(iso("2026-10-02", t, i > 1 ? 1 : 0), HOME)), { isHome });
  assert.equal(covered["2026-10-02"].status, "home");
  const mac = eveningEpisodes([fix(iso("2026-10-02", "02:21", 1), HOME)], { isHome, sessions: [{ start: iso("2026-10-02", "21:30"), end: iso("2026-10-02", "01:30", 1) }] });
  assert.equal(mac["2026-10-02"].status, "home");
  assert.equal(homeAllNight([], [], "2026-10-02"), false);
  // and a gap week does not break a learned Friday
  const r = learn([...nightOut("2026-10-09"), ...nightOut("2026-10-16"), ...nightOut("2026-10-23"), fix(iso("2026-10-02", "21:14"), HOME), fix(iso("2026-10-02", "02:21", 1), HOME)])[0];
  assert.equal(r.misses, 0);
});

test("late departures count: home 23:30 then away 01:10, or Mac until 23:30 then away 01:20; a lone fix near home still drops", async () => {
  const { eveningEpisodes } = await import("../scripts/lib/patterns/episodes.mjs");
  const d = "2026-10-16";
  const afterHome = eveningEpisodes([fix(iso(d, "23:30"), HOME), fix(iso(d, "01:10", 1), CLUB), fix(iso(d, "01:40", 1), CLUB)], { isHome });
  assert.equal(afterHome[d].status, "out");
  const afterMac = eveningEpisodes([fix(iso(d, "01:20", 1), CLUB), fix(iso(d, "02:05", 1), CLUB)], { isHome, sessions: [{ start: iso(d, "20:00"), end: iso(d, "23:30") }] });
  assert.equal(afterMac[d].status, "out");
  // still drift: home evidence after midnight (the 14 Oct case), a single fix next to home evidence, or he was asleep
  const macPastMidnight = eveningEpisodes(["02:32", "03:51"].map((t) => fix(iso(d, t, 1), CLUB)), { isHome, sessions: [{ start: iso(d, "21:23"), end: iso(d, "01:24", 1) }] });
  assert.notEqual(macPastMidnight[d].status, "out");
  const lone = eveningEpisodes([fix(iso(d, "23:30"), HOME), fix(iso(d, "01:10", 1), CLUB)], { isHome });
  assert.notEqual(lone[d].status, "out");
  const asleep = eveningEpisodes([fix(iso(d, "01:10", 1), CLUB), fix(iso(d, "01:40", 1), CLUB)], { isHome, sleeps: [iso(d, "00:40", 1)] });
  assert.notEqual(asleep[d].status, "out");
});

test("the habitual-cell home guess is used only when no home place is known, never on top of one", async () => {
  const { homeTest } = await import("../scripts/lib/patterns/sources.mjs");
  // a partner's flat: the phone sits there most nights across the week, and he goes there from home
  const FLAT = { lat: 51.518, lon: -0.08 };
  const days = Array.from({ length: 21 }, (_, i) => { const d = new Date("2026-10-24T12:00:00"); d.setDate(d.getDate() - i - 1); return d.toLocaleDateString("en-CA"); });
  const fixes = days.flatMap((d) => [fix(iso(d, "20:00"), HOME), ...["22:15", "23:30", "00:45", "02:00"].map((t, i) => fix(iso(d, t, i > 1 ? 1 : 0), FLAT, { charging: i > 1 }))]);
  const now = new Date("2026-10-24T12:00:00");
  const withHome = learnFromEvidence({ fixes, isHome, homeKnown: true }, { now }).routines;
  assert.ok(withHome.length >= 1 && withHome.every((r) => r.status === "confident"));   // known home: the flat is away, every night
  assert.deepEqual(learnFromEvidence({ fixes, isHome: () => false }, { now }).routines, []);   // no home known: the flat is home
  const places = [{ id: "home", kind: "home", lat: HOME.lat, lon: HOME.lon, radiusM: 150 }];
  assert.equal(homeTest(places, fixes)({ lat: FLAT.lat, lon: FLAT.lon }), false);           // overnight charging there adds nothing
  assert.equal(homeTest([], fixes)({ lat: FLAT.lat, lon: FLAT.lon }), true);
});
