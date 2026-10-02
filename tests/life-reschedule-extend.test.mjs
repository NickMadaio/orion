// Replays Nick's 1 October 2026 afternoon (14:19 BST): "The DS lab is taking
// longer than expected. Extend it all the way to 3. I'll take my nap after. …
// replace 'apply somewhere' with [the YouTube side project]"; "just make it fit,
// shrink it"; "naps should be at least an hour and 15 minutes long ALWAYS".
// ORION retyped the day three times, never booked the lab, then booked a SECOND
// one at 17:25. These are the tools that make that impossible.
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
const DATE = "2030-10-03";
const at = (h, m = 0) => new Date(2030, 9, 3, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
const minute = (s) => { const d = new Date(s); return d.getHours() * 60 + d.getMinutes(); };
const hm = (h, m = 0) => h * 60 + m;

const afternoon = [
  { title: "DS lab", start: at(12, 18), end: at(13, 48), orion: "study" },
  { title: "Side project (YouTube)", start: at(13, 58), end: at(14, 58), orion: "side_project" },
  { title: "Nap", start: at(15, 8), end: at(15, 53), orion: "rest" },
  { title: "Study", start: at(16, 3), end: at(17, 3), orion: "study" },
  { title: "apply to SOMEWHERE", start: at(17, 13), end: at(17, 58), orion: "other" },
  { title: "send internship applications", start: at(18, 8), end: at(19, 38), orion: "other" },
  { title: "Dinner", start: at(19, 48), end: at(20, 33), orion: "meal" },
  { title: "finish resume", start: at(20, 43), end: at(22, 13), orion: "other" },
  { title: "review CS lect 2", start: at(22, 23), end: at(23, 8), orion: "study" },
  { title: "Wind down", start: at(23, 30), end: at(23, 59), orion: "rest" },
];

function world(t, { config = {}, now = [14, 19], events = afternoon } = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-extend-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  writeFileSync(join(home, ".openclaw/orion-controlled/life-config.json"), JSON.stringify(config));
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8",
      env: { ...process.env, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar,
             ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_LIFE_CONFIG: join(home, ".openclaw/orion-controlled/life-config.json"),
             ORION_RESCHEDULE_NOW: new Date(2030, 9, 3, ...now).toISOString() } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const day = () => JSON.parse(readFileSync(calendar, "utf8"))
    .map((e) => ({ title: e.title, start: minute(e.start), end: minute(e.end) })).sort((a, b) => a.start - b.start);
  return { run, day };
}
const from = (d, m) => d.filter((x) => x.end > m);
const noOverlaps = (d) => d.every((x, i) => d.slice(i + 1).every((y) => !(x.start < y.end && y.start < x.end)));

test("extend the lab to 3: one lab, 12:18–15:00, the nap after it, nothing overlapping", (t) => {
  const { run, day } = world(t);
  const r = run("extend", "DS lab", "--until", "15:00");
  assert.equal(r.code, 0, r.out);
  const d = day();
  const labs = d.filter((x) => /ds lab/i.test(x.title));
  assert.equal(labs.length, 1, JSON.stringify(d));
  assert.deepEqual([labs[0].start, labs[0].end], [hm(12, 18), hm(15)]);
  assert.ok(d.find((x) => x.title === "Nap").start >= hm(15), r.out);
  assert.ok(noOverlaps(from(d, hm(14, 19))), JSON.stringify(d));
});

test("restating the lab at a time already gone is refused and points at extend", (t) => {
  const { run, day } = world(t);
  const before = day();
  const r = run("day", "--replace", "--plan", "DS lab, 120, 13:00", "--plan", "nap, 75, 15:00");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NOTHING WAS CHANGED/);
  assert.match(r.out, /extend "DS lab"/);
  assert.deepEqual(day(), before);
});

test("replace 'apply somewhere' with the YouTube project: existing block moved, no duplicate", (t) => {
  const { run, day } = world(t);
  const r = run("rename", "apply to SOMEWHERE", "YouTube side project");
  assert.equal(r.code, 0, r.out);
  const d = day();
  assert.ok(!d.some((x) => /apply to/i.test(x.title)));
  const yt = d.find(x => /youtube/i.test(x.title));
  assert.equal(d.filter(x => /youtube/i.test(x.title)).length, 1);
  assert.deepEqual([yt.start, yt.end], [hm(17, 13), hm(18, 13)]);
});

test("naps are at least 75 minutes once he says so, and the low-priority work shrinks to fit", (t) => {
  const { run, day } = world(t, { config: { minimums: { nap: 75 } } });
  const r = run("resize", "Nap", "75");
  assert.equal(r.code, 0, r.out);
  const d = day();
  const nap = d.find((x) => x.title === "Nap");
  assert.equal(nap.end - nap.start, 75);
  assert.ok(noOverlaps(from(d, hm(14, 19))), JSON.stringify(d));
});

// His day at 14:20, after ORION's second retype: YouTube had been put last.
const evening = [
  { title: "nap", start: at(15), end: at(15, 45), orion: "rest" },
  { title: "study", start: at(16, 3), end: at(17, 3), orion: "study" },
  { title: "send internship applications", start: at(18, 8), end: at(19, 38), orion: "other" },
  { title: "dinner", start: at(19, 48), end: at(20, 33), orion: "meal" },
  { title: "finish resume", start: at(20, 43), end: at(22, 13), orion: "other" },
  { title: "YouTube side project", start: at(22, 23), end: at(23, 23), orion: "side_project" },
  { title: "wind down", start: at(23, 30), end: at(23, 59), orion: "rest" },
];

test("'naps at least 1h15, push study back': the YouTube block shrinks, no work is dropped", (t) => {
  const { run, day } = world(t, { events: evening, now: [14, 20], config: { minimums: { nap: 75 } } });
  const r = run("resize", "nap", "75");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /SHRUNK to fit: YouTube side project 60 → \d+ min/);
  assert.doesNotMatch(r.out, /NOT BOOKED/);
  const d = day();
  assert.ok(noOverlaps(from(d, hm(14, 20))), JSON.stringify(d));
  const nap = d.find((x) => x.title === "nap");
  assert.equal(nap.end - nap.start, 75);
  assert.ok(d.find((x) => x.title === "study").start >= nap.end, "study pushed back after the nap");
  for (const title of ["finish resume", "send internship applications", "dinner"]) {
    const was = evening.find((e) => e.title === title);
    const now = d.find((x) => x.title === title);
    assert.equal(now.end - now.start, minute(was.end) - minute(was.start), `${title} keeps its length`);
  }
});

test("when shrinking cannot make room, the work that does not fit is named, never silently lost", (t) => {
  const { run, day } = world(t);
  const r = run("extend", "DS lab", "--until", "16:30", "--then", "Nap");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /NOT BOOKED: .*ask him/);
  const d = day();
  assert.ok(noOverlaps(from(d, hm(14, 19))), JSON.stringify(d));
  assert.ok(d.find((x) => x.title === "Nap").start >= hm(16, 30));
});

test("a whole-day replace names every block he did not mention", (t) => {
  const { run } = world(t);
  const r = run("day", "--replace", "--plan", "nap, 75, 15:00", "--plan", "study, 60", "--dry-run");
  assert.match(r.out, /DROPPED \(he did not mention them/);
  assert.match(r.out, /review CS lect 2/);
});

test("extend then undo puts the afternoon back exactly", (t) => {
  const { run, day } = world(t);
  const before = day();
  assert.equal(run("extend", "DS lab", "--until", "15:00").code, 0);
  assert.equal(run("undo").code, 0);
  assert.deepEqual(day(), before);
});

const lengthOf = (d, title) => { const x = d.find((e) => e.title === title); return x.end - x.start; };

test("move keeps the length and the rest cascades without overlaps", (t) => {
  const { run, day } = world(t);
  const r = run("move", "Study", "--to", "18:00");
  assert.equal(r.code, 0, r.out);
  const d = day();
  const study = d.find((x) => x.title === "Study");
  assert.deepEqual([study.start, study.end], [hm(18), hm(19)]);
  assert.ok(noOverlaps(from(d, hm(14, 19))), JSON.stringify(d));
});

test("moving to a time already gone is refused", (t) => {
  const { run, day } = world(t);
  const before = day();
  const r = run("move", "Study", "--to", "13:00");
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(day(), before);
});

test("an even swap trades the two slots exactly", (t) => {
  const { run, day } = world(t);
  const r = run("swap", "Nap", "apply to SOMEWHERE");     // both 45 minutes
  assert.equal(r.code, 0, r.out);
  const d = day();
  const nap = d.find((x) => x.title === "Nap"); const apply = d.find((x) => x.title === "apply to SOMEWHERE");
  assert.deepEqual([apply.start, apply.end], [hm(15, 8), hm(15, 53)]);
  assert.deepEqual([nap.start, nap.end], [hm(17, 13), hm(17, 58)]);
  assert.ok(noOverlaps(from(d, hm(14, 19))), JSON.stringify(d));
});

test("an uneven swap of neighbours keeps both lengths", (t) => {
  const { run, day } = world(t);
  const r = run("swap", "Study", "Nap");     // 60 and 45
  assert.equal(r.code, 0, r.out);
  const d = day();
  assert.ok(d.find((x) => x.title === "Study").start < d.find((x) => x.title === "Nap").start, r.out);
  assert.equal(lengthOf(d, "Study"), 60); assert.equal(lengthOf(d, "Nap"), 45);
  assert.ok(noOverlaps(from(d, hm(14, 19))), JSON.stringify(d));
});

test("an uneven swap with work in between keeps every length and nothing overlaps", (t) => {
  const { run, day } = world(t);
  // Study 60 at 16:03, apply 45 between, internship 90 at 18:08: swap Study and the 90-minute block.
  const r = run("swap", "Study", "send internship applications");
  assert.equal(r.code, 0, r.out);
  const d = day();
  const intern = d.find((x) => x.title === "send internship applications");
  const study = d.find((x) => x.title === "Study");
  assert.equal(intern.start, hm(16, 3));
  assert.ok(study.start > intern.start);
  for (const e of afternoon.filter((e) => e.start > at(14, 19)))
    assert.equal(lengthOf(d, e.title), minute(e.end) - minute(e.start), `${e.title} keeps its length`);
  assert.ok(noOverlaps(from(d, hm(14, 19))), JSON.stringify(d));
});

test("swapping something already under way is refused", (t) => {
  const { run } = world(t);
  assert.equal(run("swap", "Side project", "Study").code, 1);
});


test("explicit times persist across commands and undo", t => {
  const { run, day } = world(t);
  let r = run("move", "Dinner", "--to", "20:00"); assert.equal(r.code, 0, r.out);
  r = run("resize", "Nap", "75"); assert.equal(r.code, 0, r.out);
  assert.equal(day().find(b => b.title === "Dinner").start, hm(20));
  r = run("move", "Dinner", "--by", "-15"); assert.equal(r.code, 0, r.out);
  assert.equal(day().find(b => b.title === "Dinner").start, hm(19,45));
  assert.equal(run("undo").code, 0); assert.equal(day().find(b => b.title === "Dinner").start, hm(20));
});
test("positive relative delay", t => {
  const { run, day } = world(t); const r = run("move", "Study", "--by", "30");
  assert.equal(r.code, 0, r.out); assert.equal(day().find(b => b.title === "Study").start, hm(16,33));
});
test("minimums lengthen today's nap", t => {
  const { run, day } = world(t, { config: { minimums: { nap: 75 } } });
  const r = run("minimums"); assert.equal(r.code, 0, r.out); assert.equal(lengthOf(day(), "Nap"), 75);
});
test("more minutes extends from now after the old end", t => {
  const { run, day } = world(t); const r = run("extend", "DS lab", "30");
  assert.equal(r.code, 0, r.out); assert.equal(day().find(b => b.title === "DS lab").end, hm(14,49));
});
test("dry runs do not persist pins", t => {
  const { run, day } = world(t); const before = day();
  assert.equal(run("move", "Study", "--to", "18:00", "--dry-run").code, 0); assert.deepEqual(day(), before);
  const r = run("tidy"); assert.equal(r.code, 0, r.out); assert.equal(day().find(b => b.title === "Study").start, hm(16,3));
});

test("a timed sequence keeps reading between two distinct breaks instead of moving it to evening", t => {
 const { run, day } = world(t, { now: [7,15], events: [] });
 const r = run("day", "--plan", "Study, 60, 09:00", "--plan", "Morning break, 15", "--plan", "Reading, 45", "--plan", "Reading break, 15");
 assert.equal(r.code, 0, r.out); const d = day();
 const starts = ["Study","Morning break","Reading","Reading break"].map(title => d.find(b => b.title === title).start);
 assert.ok(starts.every((s,i) => !i || s > starts[i-1]), JSON.stringify(d)); assert.ok(starts.at(-1) < hm(12));
});
test("now and explicit add remain pinned after resizing another block", t => {
 const { run, day } = world(t);
 let r = run("now", "Lunch, 25", "Break, 15"); assert.equal(r.code,0,r.out);
 r = run("add", "Call", "20", "--at", "18:00"); assert.equal(r.code,0,r.out);
 r = run("resize", "Nap", "75"); assert.equal(r.code,0,r.out);
 assert.equal(day().find(b => b.title === "Call").start,hm(18));
 assert.equal(day().find(b => b.title === "Lunch").start,hm(14,19));
});
