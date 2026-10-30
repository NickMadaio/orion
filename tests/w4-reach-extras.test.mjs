// W4 extras (2026-10-30): "no classes" stops the class and leave ladders, held nudges perish instead of flushing, the 03:10
// all-nighter gets a bedtime line, and the spoken brief stops leading with the same slipping item every day.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classLadder } from "../scripts/lib/reach/class-ladder.mjs";
import { mergeHeld } from "../scripts/lib/reach/held.mjs";
import { awakeLateFor, bedtimeText, bedtimeVerdict, NIGHTLY_CAP } from "../scripts/lib/reach/bedtime-guard.mjs";
import { decide } from "../scripts/lib/reach/proactive.mjs";
import { briefingTop, composeBriefing } from "../scripts/lib/reach/morning.mjs";
import { readHeads, recordHead } from "../scripts/lib/reach/brief-heads.mjs";
import { tierOf } from "../scripts/lib/reach/budget.mjs";
import { isUrgentNotification, bypassesQuiet } from "../scripts/lib/reach/quiet.mjs";

const MKTG = { id: "mktg", date: "2026-10-30", title: "MKTG2201 Introduction to Marketing — Lecture", kind: "class", fixed: true, source: "calendar", start: 810, end: 900 };
const wall = { title: "Commute to class", start: 765, end: 810 };
const rungs = (ctx) => { const out = []; classLadder(ctx, (key, text) => out.push({ key, text })); return out; };

test("10-30: after 'I don't have classes today' no leave or wake rung fires for MKTG2201, and no other block is picked instead", () => {
  const base = { day: [MKTG, { id: "din", title: "Dinner", kind: "other", fixed: true, source: "calendar", start: 1140, end: 1200 }], travel: [wall], signals: {}, out: false, atHome: true };
  assert.ok(rungs({ ...base, minute: 752 }).some((r) => r.key === "leave-810"), "control: without the fact the leave nudge fires");
  const declared = [{ kind: "no-classes", text: "i dont have classes today", at: "2026-10-30T10:32:00Z" }];
  for (const minute of [752, 767, 790]) assert.deepEqual(rungs({ ...base, minute, declared }), [], `nothing at ${minute}`);
  const dated = [{ ...declared[0], date: "2026-10-30" }];
  assert.deepEqual(rungs({ ...base, minute: 767, declared: dated }), [], "a dated fact (declared-facts.json) too");
  assert.ok(rungs({ ...base, minute: 752, declared: [{ ...declared[0], date: "2026-10-29" }] }).length, "yesterday's fact does not cancel today");
});

test("held nudges perish after 30 min instead of flushing later; a counted line never comes out stale", () => {
  const now = Date.parse("2026-10-18T09:30:00Z");
  const old = (text, kind = "checkin") => ({ id: text, at: "2026-10-18T08:40:00Z", text, kind, heldFor: "focus" });
  const r = mergeHeld([old("It's been 1039 min. Gym, now."), old("Leave in 12 min for CS1800.", "reminder"), old("Bills are due.", "update"),
    { id: "fresh", at: "2026-10-18T09:20:00Z", text: "Time to start: Gym.", kind: "checkin", heldFor: "focus" }], { now });
  assert.deepEqual(r.lines, ["Bills are due.", "Time to start: Gym."]);
  assert.equal(r.stale.length, 2);
});

test("a plan L2 is time-sensitive on the phone but bypasses nothing, and is not protected by itself", () => {
  assert.equal(isUrgentNotification({ urgent: true, urgentKind: "plan" }), true);
  assert.equal(bypassesQuiet({ urgentKind: "plan" }), false);
  assert.equal(tierOf({ why: "plan: cal-1", urgentKind: "plan" }), "low");
  assert.equal(tierOf({ why: "plan: cal-1", urgentKind: "plan", tier: "protected" }), "protected");
});

test("03:10 after an all-nighter: awake-late.json for tonight supplies the words, the cap allows one more, the proactive tick says it", () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-awake-"));
  const now = new Date(2026, 9, 26, 3, 10);
  const message = "It's 3:10 AM and CS2100 is at 9:00 AM. Bed now still gets you about 4.6h before the alarm. Go to bed. I've already lightened tomorrow around it.";
  assert.equal(awakeLateFor({ dir, now }), null);
  writeFileSync(join(dir, "awake-late.json"), JSON.stringify({ night: "2026-10-25", at: new Date(2026, 9, 26, 3, 5).toISOString(), message }));
  assert.equal(bedtimeText({ dir, now, text: "Still up." }), message);
  assert.equal(awakeLateFor({ dir, now: new Date(2026, 9, 26, 5, 0) }), null, "an hour-old flag is stale");
  writeFileSync(join(dir, "awake-late.json"), JSON.stringify({ night: "2026-10-24", at: new Date(2026, 9, 26, 3, 5).toISOString(), message }));
  assert.equal(bedtimeText({ dir, now, text: "Still up." }), "Still up.", "another night's flag is not tonight's");
  const e = { now, bed: 0, mac: { idleSeconds: 5 }, sentTonight: NIGHTLY_CAP };
  assert.equal(bedtimeVerdict(e).ok, false);
  assert.equal(bedtimeVerdict({ ...e, awakeLate: true }).ok, true);
  const said = decide({ minute: 190, bed: "00:00", wake: "07:45", day: [], sent: {}, idleSeconds: 5, sessionState: "focus", atHome: true, awakeLate: message, skipLadder: true });
  assert.deepEqual(said.map((m) => [m.key, m.text]), [["bed-late-allnighter", message]]);
});

test("the spoken brief: the same head three days running is said as slipping, with the choice", () => {
  const todos = [{ title: "finish resume" }, { title: "Student oyster card" }];
  assert.equal(briefingTop({ todos, headHistory: [], today: "2026-10-30" }).text, "First on my list: finish resume.");
  const dir = mkdtempSync(join(tmpdir(), "orion-heads-"));
  recordHead(dir, "2026-10-28", "finish resume"); recordHead(dir, "2026-10-29", "finish resume"); recordHead(dir, "2026-10-30", "x");
  const headHistory = readHeads(dir, "2026-10-30");
  assert.deepEqual(headHistory.map((h) => h.date), ["2026-10-29", "2026-10-28"], "newest first, today's own entry left out");
  const text = composeBriefing({ now: new Date(2026, 9, 30, 9, 0), day: [], todos, today: "2026-10-30", headHistory });
  assert.match(text, /finish resume has been first on my list 3 days running and hasn't moved - this keeps slipping\. Give it a time today, or drop it\?/);
  assert.doesNotMatch(text, /Top of your list/);
});
