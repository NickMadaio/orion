// orion-reschedule end to end against a fake calendar, replaying Nick's messages
// from 2026-09-30 (soccer 5-7 onto a full day; "get rid of studying and Orion
// stuff"; "clear everything and redo it: nap 90 at 1, internship stuff 90…").
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-reschedule");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const DATE = "2030-10-02";                     // a future day, so "now" is midnight
const iso = (h, m = 0) => new Date(2030, 9, 2, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
const minute = (s) => { const d = new Date(s); return d.getHours() * 60 + d.getMinutes(); };

function world(t, events) {
  const home = mkdtempSync(join(tmpdir(), "orion-resched-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--date", DATE], { encoding: "utf8",
      env: { ...process.env, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar,
             ORION_RESCHEDULE_UNDO: join(home, "undo.json") } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const day = () => JSON.parse(readFileSync(calendar, "utf8"))
    .map((e) => ({ title: e.title, start: minute(e.start), end: minute(e.end) })).sort((a, b) => a.start - b.start);
  return { run, day };
}
const noOverlaps = (day) => day.every((x, i) => day.slice(i + 1).every((y) => !(x.start < y.end && y.start < x.end)));
const hm = (h, m = 0) => h * 60 + m;

const morning = [
  { title: "CS1802 Seminar", start: iso(9), end: iso(10, 30) },
  { title: "CS2100 Lab", start: iso(11), end: iso(12, 30) },
  { title: "Nap", start: iso(13), end: iso(14), orion: "rest" },
  { title: "fix Orion stuff", start: iso(14), end: iso(15), orion: "other" },
  { title: "finish resume", start: iso(15), end: iso(16, 30), orion: "other" },
  { title: "send internship applications", start: iso(16, 30), end: iso(18), orion: "other" },
  { title: "Gym", start: iso(18), end: iso(19), orion: "gym" },
  { title: "Dinner", start: iso(19), end: iso(19, 45), orion: "meal" },
  { title: "Side project (YouTube)", start: iso(19, 45), end: iso(20, 45), orion: "side_project" },
  { title: "study (if there's time)", start: iso(21), end: iso(22), orion: "study" },
];

test("soccer onto a full day: it goes in, nothing overlaps, nothing is duplicated", (t) => {
  const { run, day } = world(t, morning);
  const r = run("day", "--plan", "soccer practice, 120, 17:00, fixed");
  assert.equal(r.code, 0, r.out);
  const d = day();
  assert.ok(d.some((e) => e.title === "soccer practice" && e.start === hm(17) && e.end === hm(19)), r.out);
  assert.ok(noOverlaps(d), JSON.stringify(d));
  assert.equal(d.filter((e) => /soccer/i.test(e.title)).length, 1);
});

test("drop removes what he names, and only that", (t) => {
  const { run, day } = world(t, morning);
  const r = run("drop", "studying", "Orion stuff");
  assert.equal(r.code, 0, r.out);
  const titles = day().map((e) => e.title);
  assert.ok(!titles.includes("study (if there's time)") && !titles.includes("fix Orion stuff"), titles.join(", "));
  assert.equal(titles.length, morning.length - 2);
  assert.match(r.out, /cleared 2 prior schedule blocks/);
});

test("drop never removes a class", (t) => {
  const { run, day } = world(t, morning);
  const r = run("drop", "CS2100 Lab");
  assert.equal(r.code, 1);
  assert.match(r.out, /NOTHING WAS DROPPED/);
  assert.equal(day().length, morning.length);
});

test("clear and redo: his timeline goes in exactly, in order", (t) => {
  const { run, day } = world(t, morning);
  const r = run("day", "--replace",
    "--plan", "nap, 90, 13:00", "--plan", "application progress, 90, 14:30", "--plan", "snack, 30, 16:00",
    "--plan", "soccer practice, 150, 16:30, fixed", "--plan", "dinner, 30, 19:30", "--plan", "gym, 60, 20:00");
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(day().map((e) => [e.title, e.start]), [
    ["CS1802 Seminar", hm(9)], ["CS2100 Lab", hm(11)], ["nap", hm(13)], ["application progress", hm(14, 30)],
    ["snack", hm(16)], ["soccer practice", hm(16, 30)], ["dinner", hm(19, 30)], ["gym", hm(20)],
  ]);
});

test("his times over the old plan: kept exactly, the old blocks make room", (t) => {
  const { run, day } = world(t, morning);
  const r = run("day", "--plan", "nap, 90, 13:00", "--plan", "application progress, 90, 14:30",
    "--plan", "soccer practice, 120, 17:00, fixed", "--plan", "gym, 60, 20:00");
  assert.equal(r.code, 0, r.out);
  const d = day();
  assert.ok(noOverlaps(d), JSON.stringify(d));
  for (const [title, start] of [["nap", hm(13)], ["application progress", hm(14, 30)], ["soccer practice", hm(17)], ["gym", hm(20)]])
    assert.equal(d.find((e) => e.title === title)?.start, start, `${title}\n${r.out}`);
  assert.equal(d.filter((e) => /^nap$/i.test(e.title)).length, 1, "restating the nap replaces it");
  assert.equal(d.filter((e) => /^gym$/i.test(e.title)).length, 1, "restating gym replaces it");
});

test("after and before soccer are read from the title", (t) => {
  const { run, day } = world(t, [morning[0], morning[1], { title: "soccer practice", start: iso(17), end: iso(19) }]);
  const r = run("day", "--plan", "resume work before soccer, 60", "--plan", "dinner after soccer, 30", "--plan", "gym after soccer, 60");
  assert.equal(r.code, 0, r.out);
  const d = day(); const get = (x) => d.find((e) => e.title === x);
  assert.ok(get("resume work").end <= hm(17), r.out);
  assert.ok(get("dinner").start >= hm(19) && get("gym").start >= get("dinner").end, r.out);
  assert.ok(noOverlaps(d));
});

test("undo puts the day back exactly", (t) => {
  const { run, day } = world(t, morning);
  const before = day();
  assert.equal(run("day", "--plan", "soccer practice, 120, 17:00, fixed").code, 0);
  assert.notDeepEqual(day(), before);
  const u = run("undo");
  assert.equal(u.code, 0, u.out);
  assert.deepEqual(day(), before);
});

test("drop with no date finds tomorrow's block when today has none", (t) => {
  const d = new Date(Date.now() + 86400000);
  const at = (h) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).toISOString().replace(/\.\d{3}Z$/, "Z");
  const home = mkdtempSync(join(tmpdir(), "orion-resched-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify([{ identifier: "r", title: "resume work", start: at(10), end: at(11), orion: "other" },
    { identifier: "g", title: "Gym", start: at(18), end: at(19), orion: "gym" }]));
  const r = spawnSync(process.execPath, [SCRIPT, "drop", "resume work"], { encoding: "utf8",
    env: { ...process.env, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, ORION_RESCHEDULE_UNDO: join(home, "undo.json") } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /nothing matched today, so tomorrow/);
  assert.deepEqual(JSON.parse(readFileSync(calendar, "utf8")).map((e) => e.title), ["Gym"]);
});

test("a bare date is the date, never silently today", (t) => {
  const { run, day } = world(t, morning);
  const r = spawnSync(process.execPath, [SCRIPT, "day", DATE, "--plan", "soccer practice, 120, 17:00, fixed"], { encoding: "utf8",
    env: { ...process.env, HOME: join(tmpdir(), "unused"), ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: "/dev/null" } });
  assert.ok(r, "runs");
  assert.match(run("day", "--plan", "soccer practice, 120, 17:00, fixed").out, /Thursday|Wednesday|Changed/);
  assert.ok(day().some((e) => e.title === "soccer practice"));
});

test("replace keeps a fixed plan he restated at the same time (2026-09-30: soccer vanished)", (t) => {
  const { run, day } = world(t, [morning[0], morning[1], { title: "soccer practice", start: iso(16, 30), end: iso(19, 30) },
    { title: "workout", start: iso(20), end: iso(21), orion: "gym" }]);
  const r = run("day", "--replace", "--plan", "soccer practice, 180, 16:30, fixed", "--plan", "workout, 60, 21:00");
  assert.equal(r.code, 0, r.out);
  const d = day();
  assert.ok(d.some((e) => e.title === "soccer practice" && e.start === hm(16, 30)), `soccer kept\n${r.out}`);
  assert.equal(d.find((e) => e.title === "workout").start, hm(21));
});

test("moving one block is one add, and the old copy goes", (t) => {
  const { run, day } = world(t, [morning[0], { title: "workout", start: iso(20), end: iso(21), orion: "gym" },
    { title: "reading", start: iso(21), end: iso(21, 30), orion: "rest" }]);
  const r = run("add", "workout, 60", "--at", "21:00");
  assert.equal(r.code, 0, r.out);
  const d = day();
  assert.deepEqual(d.filter((e) => e.title === "workout").map((e) => e.start), [hm(21)]);
  assert.ok(d.find((e) => e.title === "reading").start >= hm(22), "reading makes way");
});

test("a lecture running over on another day pushes what was booked just after the trip home", (t) => {
  const { run, day } = world(t, [morning[0], { title: "Side project (YouTube)", start: iso(11), end: iso(12), orion: "side_project" }]);
  const r = run("overrun", "20");
  assert.equal(r.code, 0, r.out);
  assert.ok(day().find((e) => /side project/i.test(e.title)).start >= hm(11, 20), r.out);
});

test("an overrun slides the next blocks back in order instead of flinging one to the evening", (t) => {
  const { run, day } = world(t, [morning[0],
    { title: "internship apps", start: iso(11), end: iso(13), orion: "other" },
    { title: "resume", start: iso(13), end: iso(14), orion: "other" },
    { title: "soccer practice", start: iso(17), end: iso(19) }]);
  const r = run("overrun", "20");
  assert.equal(r.code, 0, r.out);
  const d = day(); const get = (x) => d.find((e) => e.title === x).start;
  assert.equal(get("internship apps"), hm(11, 30), r.out);   // trip home ends 11:20, then the 10-min gap
  assert.equal(get("resume"), hm(13, 40));
});

test("travel after soccer counts even when soccer is added in the same call", (t) => {
  const { run, day } = world(t, [morning[0]]);
  const r = run("day", "--plan", "soccer practice, 120, 17:00, fixed", "--plan", "dinner after soccer, 45", "--plan", "gym after soccer, 60");
  assert.equal(r.code, 0, r.out);
  const d = day(); const get = (x) => d.find((e) => e.title === x);
  assert.ok(get("dinner").start >= hm(19, 30), r.out);
  assert.ok(get("gym").start >= get("dinner").end, "in the order he said");
});

test("untimed plans after a fixed one keep the order he said them in", (t) => {
  const { run, day } = world(t, [morning[0]]);
  const r = run("day", "--plan", "soccer practice, 120, 17:00, fixed", "--plan", "dinner, 45", "--plan", "gym, 60");
  assert.equal(r.code, 0, r.out);
  const d = day(); const get = (x) => d.find((e) => e.title === x);
  assert.ok(get("dinner").start >= hm(19, 30) && get("gym").start >= get("dinner").end, r.out);
});

test("wind down ends on the asleep line, which moves earlier before an early class", (t) => {
  const next = (h, m = 0) => new Date(2030, 9, 3, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
  const { run, day } = world(t, [morning[0], { title: "CS2100 Lab", start: next(8), end: next(9, 30) }]);
  const r = run("fill");
  assert.equal(r.code, 0, r.out);
  const wind = day().find((e) => /wind down/i.test(e.title));
  // 8:00 lab − 105 min ready (7:15 for a 9:00 class, Nick) = 6:15 wake; 8 h before = asleep by 22:15.
  assert.equal(wind?.end, hm(22, 15), r.out);
});

test("day --todos books each to-do as its own block, never groceries (2026-10-01)", (t) => {
  const home = mkdtempSync(join(tmpdir(), "orion-resched-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  const calendar = join(home, "calendar.json"); const reminders = join(home, "reminders.json");
  writeFileSync(calendar, JSON.stringify([{ identifier: "l", ...{ title: "CS1800 Lecture", start: iso(9), end: iso(10, 30) } }]));
  const todo = (title, list = "Orion") => ({ identifier: title, title, list });
  writeFileSync(reminders, JSON.stringify([todo("review CS lect 2"), todo("research backpacking stuff"), todo("finish resume"),
    todo("thinking fast and slow book"), todo("study (if there's time)"), todo("Hairspray", "Groceries")]));
  const r = spawnSync(process.execPath, [SCRIPT, "day", "--todos", "--date", DATE], { encoding: "utf8",
    env: { ...process.env, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, FAKE_REMINDERS: reminders, ORION_RESCHEDULE_UNDO: join(home, "u.json") } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const titles = JSON.parse(readFileSync(calendar, "utf8")).map((e) => e.title);
  for (const t of ["review CS lect 2", "research backpacking stuff", "finish resume", "thinking fast and slow book"]) assert.ok(titles.includes(t), `${t}\n${r.stdout}`);
  assert.ok(!titles.some((t) => /hairspray/i.test(t)), "groceries never planned");
  assert.ok(!titles.some((t) => t.includes(",")), "no merged blocks");
  const events = JSON.parse(readFileSync(calendar, "utf8")).map((e) => ({ t: e.title, s: new Date(e.start) }));
  assert.ok(events.filter((e) => e.t !== "CS1800 Lecture").every((e) => e.s.getHours() * 60 + e.s.getMinutes() >= 11 * 60), "after he is home from class");
});

test("'just got home, eating now, then a break — rearrange' (2026-10-01 10:28)", (t) => {
  const D = (h, m = 0) => new Date(2030, 9, 2, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
  const { run, day } = world(t, [
    { title: "CS1800 Lecture", start: D(9), end: D(10, 30) },
    { title: "DS lab", start: D(11), end: D(12, 30), orion: "other" },
    { title: "Side project (YouTube)", start: D(12, 30), end: D(13, 30), orion: "side_project" },
    { title: "apply to SOMEWHERE", start: D(14), end: D(14, 45), orion: "other" },
    { title: "Dinner", start: D(18, 30), end: D(19, 15), orion: "meal" },
  ]);
  // --at stands in for "now" (the fake day is in the future): he got home at 10:40.
  const r = run("now", "Lunch, 25", "Break, 15", "--at", "10:40");
  assert.equal(r.code, 0, r.out);
  const d = day(); const get = (x) => d.find((e) => e.title === x);
  assert.equal(get("Lunch").start, hm(10, 40));
  assert.equal(get("Break").start, hm(11, 5));
  assert.equal(get("DS lab").start, hm(11, 30), "what was booked during lunch slides to after the break, with a gap");
  assert.equal(get("Side project (YouTube)").start, hm(13, 10), "and the next thing after it, in order");
  assert.equal(get("apply to SOMEWHERE").start, hm(14, 20), "pushed only as far as the side project plus the gap");
  assert.equal(get("Dinner").start, hm(18, 30), "dinner never moves earlier");
  assert.ok(d.every((x, i) => d.slice(i + 1).every((y) => !(x.start < y.end && y.start < x.end))), "no overlaps");
});

test("a block already under way when he got home slides too (DS lab 11:00, home 11:28)", (t) => {
  const D = (h, m = 0) => new Date(2030, 9, 2, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
  const { run, day } = world(t, [
    { title: "DS lab", start: D(11), end: D(12, 30), orion: "other" },
    { title: "Side project (YouTube)", start: D(12, 30), end: D(13, 30), orion: "side_project" },
    { title: "Dinner", start: D(18, 30), end: D(19, 15), orion: "meal" },
  ]);
  const r = run("now", "Lunch, 25", "Break, 15", "--at", "11:28");
  assert.equal(r.code, 0, r.out);
  const d = day(); const get = (x) => d.find((e) => e.title === x);
  assert.equal(get("Lunch").start, hm(11, 28));
  assert.equal(get("DS lab").start, hm(12, 18), r.out);
  assert.equal(get("Side project (YouTube)").start, hm(13, 58));
  assert.equal(get("Dinner").start, hm(18, 30));
});

test("an overlap already on the calendar is separated by the next change, with a gap", (t) => {
  const D = (h, m = 0) => new Date(2030, 9, 2, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
  const { run, day } = world(t, [
    { title: "Lunch", start: D(11, 30), end: D(12), orion: "meal" },
    { title: "Break", start: D(11, 50), end: D(12, 10), orion: "rest" },
    { title: "DS lab", start: D(12), end: D(13, 30), orion: "study" },
  ]);
  const r = run("add", "Gym", "60", "--at", "18:00");
  assert.equal(r.code, 0, r.out);
  const d = day().sort((a, b) => a.start - b.start);
  for (let i = 1; i < d.length; i++) assert.ok(d[i].start >= d[i - 1].end + 10, `${d[i - 1].title} → ${d[i].title}\n${r.out}`);
});

// 2026-10-07: "make the cs lab one hour, directly after my CS2100 class".
// "CS lab" matched the CS2100 *Lab* (the class) first: move/resize refused, and
// skip "CS lab" deleted his class. The closest title must win.
const labDay = [
  { title: "CS1802 Discrete Structures — Seminar", start: iso(9), end: iso(10, 30) },
  { title: "CS2100 Program Design & Implementation 1 — Lab", start: iso(11), end: iso(12, 30) },
  { title: "CS lab", start: iso(13, 20), end: iso(14, 20), orion: "study" },
  { title: "DS Assesment W comp sci group", start: iso(15), end: iso(16) },
];

test("move \"CS lab\" moves the CS lab block, not the CS2100 Lab class (2026-10-07)", (t) => {
  const { run, day } = world(t, labDay);
  const r = run("move", "CS lab", "--to", "12:30");
  assert.equal(r.code, 0, r.out);
  const d = day();
  assert.ok(d.some((e) => e.title === "CS lab" && e.start === hm(12, 30)), r.out);
  assert.ok(d.some((e) => /CS2100/.test(e.title) && e.start === hm(11)), "the class is untouched");
});

test("resize \"CS lab\" resizes the CS lab block (2026-10-07)", (t) => {
  const { run, day } = world(t, labDay);
  const r = run("resize", "CS lab", "45");
  assert.equal(r.code, 0, r.out);
  assert.ok(day().some((e) => e.title === "CS lab" && e.end - e.start === 45), r.out);
});

test("skip \"CS lab\" never deletes the CS2100 Lab class (2026-10-07)", (t) => {
  const { run, day } = world(t, labDay);
  const r = run("skip", "CS lab");
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /NOTHING WAS CHANGED/);
  assert.match(r.out, /CS lab/);
  assert.ok(day().some((e) => /CS2100/.test(e.title)), "the class is still there");
});

// 2026-10-07: "start organize safari directly after CS lab, same end conditions"
// (end 20 minutes before the DS assessment) took two messages and four failed
// calls: extend adds minutes, and ORION did the arithmetic. One call now.
const safariDay = [
  { title: "CS2100 Lab", start: iso(11), end: iso(12, 30) },
  { title: "CS lab", start: iso(12, 30), end: iso(13, 30), orion: "study" },
  { title: "organize safari", start: iso(14, 15), end: iso(14, 40), orion: "other" },
  { title: "DS Assesment W comp sci group", start: iso(15), end: iso(17) },
];

test("move --after X --before Y --gap 20 sets both ends in one call (2026-10-07)", (t) => {
  const { run, day } = world(t, safariDay);
  const r = run("move", "organize safari", "--after", "CS lab", "--before", "DS Assesment", "--gap", "20");
  assert.equal(r.code, 0, r.out);
  const safari = day().find((e) => e.title === "organize safari");
  assert.equal(safari.start, hm(13, 40), r.out);   // CS lab end + the usual buffer
  assert.equal(safari.end, hm(14, 40), r.out);     // 20 minutes before 15:00
});

test("move --to with --until sets an exact window (2026-10-07)", (t) => {
  const { run, day } = world(t, safariDay);
  const r = run("move", "organize safari", "--to", "13:30", "--until", "14:40");
  assert.equal(r.code, 0, r.out);
  const safari = day().find((e) => e.title === "organize safari");
  assert.deepEqual([safari.start, safari.end], [hm(13, 30), hm(14, 40)], r.out);
});

test("an extend that clashes says extend ADDS minutes and how to set an end instead (2026-10-07)", (t) => {
  const { run } = world(t, safariDay);
  const r = run("extend", "organize safari", "70");
  assert.notEqual(r.code, 0);
  assert.match(r.out, /adds 70 minutes/i);
  assert.match(r.out, /--until/);
});

// 2026-10-07: `drop "send internship applications" move "Study" --by 30` dropped
// Study too (every word after drop was a title) and ignored --by; ORION then
// reported both changes as done. Two commands in one call is refused, whole.
test("two commands glued into one call change nothing (2026-10-07)", (t) => {
  const { run, day } = world(t, morning);
  const r = run("drop", "send internship applications", "move", "Study", "--by", "30");
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /NOTHING WAS CHANGED/);
  assert.match(r.out, /one command per call/i);
  assert.ok(day().some((e) => e.title === "send internship applications"), "nothing was dropped");
  assert.ok(day().some((e) => e.title === "study (if there's time)"));
});

test("an option that belongs to another command is refused (2026-10-07)", (t) => {
  const { run, day } = world(t, morning);
  const r = run("drop", "Gym", "--by", "30");
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /--by/);
  assert.ok(day().some((e) => e.title === "Gym"));
});
