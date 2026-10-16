// WP6 scenarios 9 and 18: orion-reschedule log replaces the plan with reality, keeps the slip for the review
// (not the calendar), re-weighs the rest of today by weight, and is one undo step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-reschedule");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const DATE = "2030-10-03";
const at = (h, m = 0) => new Date(2030, 9, 3, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");

export function world(t, events, now) {
  const home = mkdtempSync(join(tmpdir(), "orion-log-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const controlled = join(home, ".openclaw/orion-controlled");
  mkdirSync(controlled, { recursive: true });
  writeFileSync(join(home, "life.json"), "{}");
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, ...(args.includes("--date") ? [] : ["--date", DATE])], { encoding: "utf8",
      env: { ...process.env, HOME: home, ORION_CONTROLLED_DIR: controlled, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, ORION_LIFE_CONFIG: join(home, "life.json"),
        ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"),
        ORION_RESCHEDULE_NOW: new Date(2030, 9, 3, ...now).toISOString() } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const cal = () => JSON.parse(readFileSync(calendar, "utf8"));
  const slipsPath = join(controlled, "slips.jsonl");
  const slips = () => (existsSync(slipsPath) ? readFileSync(slipsPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const shape = () => cal().map((e) => `${e.title} ${e.start}–${e.end}`).sort();
  return { run, cal, slips, shape, controlled };
}

const lecture = { title: "CS1800 Discrete Structures — Lecture", start: at(9), end: at(10, 30) };
const resume = { title: "finish resume", start: at(14), end: at(16), orion: "other" };

test("scenario 9: gym over a planned finish resume renames it in place, one slip, no trace of the plan, one undo", (t) => {
  const w = world(t, [lecture, resume], [17, 0]);
  const before = w.shape();
  const r = w.run("log", "gym", "--from", "14:00", "--to", "16:00", "--no-replan");
  assert.equal(r.code, 0, r.out);
  const gym = w.cal().find((e) => e.title === "gym");
  assert.equal(gym.start, at(14)); assert.equal(gym.end, at(16));
  assert.deepEqual(gym.orionTags.split(","), ["gym", "logged"]);
  assert.ok(!w.cal().some((e) => /resume/i.test(e.title)), "finish resume leaves no trace on the calendar");
  assert.equal(w.slips().length, 1);
  assert.deepEqual({ title: w.slips()[0].planned.title, missed: w.slips()[0].missedMinutes, by: w.slips()[0].replacedBy, reason: w.slips()[0].reason, rank: w.slips()[0].planned.rank },
    { title: "finish resume", missed: 120, by: "gym", reason: "reality", rank: "medium" });
  assert.match(r.out.trim().split("\n").at(-1), /^Logged gym 2-4\./);
  const undone = w.run("undo");
  assert.match(undone.out, /Undone/);
  assert.deepEqual(w.shape(), before);
  assert.equal(w.slips().length, 0, "undo takes the slips back too");
});

test("with room left, the displaced block re-enters later today (the re-weigh)", (t) => {
  const w = world(t, [lecture, resume], [17, 0]);
  const r = w.run("log", "gym", "--from", "14:00", "--to", "16:00");
  assert.equal(r.code, 0, r.out);
  const back = w.cal().find((e) => e.title === "finish resume");
  assert.ok(back && new Date(back.start) >= new Date(at(17)), r.out);
  assert.match(r.out.trim().split("\n").at(-1), /Finish resume moved to /);
  assert.equal(w.slips()[0].reason, "reality");
});

test("a fixed class is never overwritten: the logged event is trimmed around it", (t) => {
  const w = world(t, [lecture], [17, 0]);
  const r = w.run("log", "library", "--from", "09:30", "--to", "11:00");
  assert.equal(r.code, 0, r.out);
  assert.ok(w.cal().some((e) => e.title === lecture.title && e.start === lecture.start && e.end === lecture.end));
  const lib = w.cal().find((e) => e.title === "library");
  assert.equal(lib.start, at(10, 30)); assert.equal(lib.end, at(11));
  const covered = w.run("log", "library", "--from", "09:10", "--to", "10:00");
  assert.equal(covered.code, 1, covered.out);
  assert.match(covered.out, /NOTHING WAS CHANGED/);
});

test("a partial overlap trims the planned block to the part outside", (t) => {
  const w = world(t, [resume], [16, 0]);
  const r = w.run("log", "gym", "--from", "15:00", "--to", "16:00", "--no-replan");
  assert.equal(r.code, 0, r.out);
  const kept = w.cal().find((e) => e.title === "finish resume");
  assert.equal(kept.start, at(14)); assert.equal(kept.end, at(15));
  assert.equal(w.slips()[0].missedMinutes, 60);
});

test("--instead names the block that did not happen, even one fully over", (t) => {
  const w = world(t, [{ title: "finish resume", start: at(18), end: at(19), orion: "other" }, { title: "Dinner with Sam", start: at(19, 30), end: at(21) }], [20, 0]);
  const r = w.run("log", "gym", "--from", "14:00", "--to", "16:00", "--instead", "resume", "--no-replan");
  assert.equal(r.code, 0, r.out);
  assert.ok(!w.cal().some((e) => e.title === "finish resume"));
  assert.equal(w.slips()[0].planned.title, "finish resume");
  const missing = w.run("log", "gym", "--from", "14:00", "--to", "16:00", "--instead", "nothing like this");
  assert.equal(missing.code, 1);
});

test("refuses what is not allowed: before 04:00, more than 3 h ahead, a day that is not today, over done work", (t) => {
  const w = world(t, [resume], [16, 0]);
  assert.equal(w.run("log", "x", "--from", "03:00", "--to", "03:30").code, 1);
  assert.equal(w.run("log", "x", "--from", "17:00", "--to", "19:30").code, 1);
  assert.equal(w.run("log", "x", "--from", "14:00", "--to", "15:00", "--date", "2030-10-04").code, 1);
  assert.equal(w.run("log", "gym", "--from", "14:00", "--to", "15:00", "--no-replan").code, 0);
  const again = w.run("log", "walk", "--from", "14:30", "--to", "15:00");
  assert.equal(again.code, 1, again.out);
  assert.match(again.out, /already logged/);
});

// His own plans carry a 30 min trip each way (commute walls), so the free stretch is 18:40-21:00.
const dinner = { title: "Dinner with Sam", start: at(16, 10), end: at(18) };
const club = { title: "Club night with friends", start: at(21, 40), end: at(23, 59) };
const planned = { title: "finish resume", start: at(14), end: at(15, 30), orion: "other" };

test("scenario 18: logging gym over finish resume bumps a lower-ranked YouTube and records why", (t) => {
  const youtube = { title: "YouTube", start: at(18, 40), end: at(20, 10), orion: "side_project", orionTags: "side_project,rank-low" };
  const w = world(t, [planned, dinner, youtube, club], [16, 0]);
  const r = w.run("log", "gym", "--from", "14:00", "--to", "15:30");
  assert.equal(r.code, 0, r.out);
  const resumeNow = w.cal().find((e) => e.title === "finish resume");
  assert.equal(resumeNow?.start, at(18, 40), r.out);
  assert.ok(!w.cal().some((e) => e.title === "YouTube"));
  assert.ok(w.slips().some((s) => s.reason === "bumped:finish resume" && s.planned.title === "YouTube"));
  assert.match(r.out.trim().split("\n").at(-1), /^Logged gym 2-3:30\. Finish resume moved to 6:40-8:10; YouTube is off today\.$/);
});

test("scenario 18b: an equal rank is never bumped; the displaced item says no-room", (t) => {
  const todo = { title: "email prof", start: at(18, 40), end: at(20, 10), orion: "other" };
  const w = world(t, [planned, dinner, todo, club], [16, 0]);
  const r = w.run("log", "gym", "--from", "14:00", "--to", "15:30");
  assert.equal(r.code, 0, r.out);
  assert.ok(w.cal().some((e) => e.title === "email prof"));
  assert.ok(!w.cal().some((e) => e.title === "finish resume"));
  const rows = w.slips();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, "no-room");
  assert.match(r.out, /no room today/);
});

test("a stored rank tag outranks the kind default, and a displaced low item is not re-entered", (t) => {
  const breakBlock = { title: "Break", start: at(14), end: at(14, 30), orion: "rest" };
  const w = world(t, [breakBlock], [17, 0]);
  const r = w.run("log", "walk", "--from", "14:00", "--to", "14:30");
  assert.equal(r.code, 0, r.out);
  assert.ok(!w.cal().some((e) => e.title === "Break"));
  assert.equal(w.slips()[0].planned.rank, "low");
});

test("log and displace touch awareness.dirty", (t) => {
  const w = world(t, [resume], [17, 0]);
  w.run("log", "gym", "--from", "14:00", "--to", "16:00", "--no-replan");
  assert.ok(existsSync(join(w.controlled, "awareness.dirty")));
});

test("displace: a started block that will not happen leaves its slot and is re-weighed", (t) => {
  const running = { title: "finish resume", start: at(14), end: at(16), orion: "other" };
  const w = world(t, [running], [14, 30]);
  const r = w.run("displace", "finish resume", "--why", "gave-up");
  assert.equal(r.code, 0, r.out);
  const back = w.cal().find((e) => e.title === "finish resume");
  assert.ok(back && new Date(back.start) >= new Date(at(14, 30)));
  assert.equal(w.slips()[0].reason, "gave-up");
  const ahead = world(t, [{ title: "finish resume", start: at(18), end: at(19), orion: "other" }], [14, 30]);
  assert.equal(ahead.run("displace", "finish resume").code, 1);
});
