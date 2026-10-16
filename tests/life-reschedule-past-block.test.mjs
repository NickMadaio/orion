// Live sweep 2026-10-15 (22:25): "push my 2pm back 20 min" printed `no block called "Review spending"`
// and then listed "Review spending 14:45–15:30" under "Blocks today". The block was there; it had ended.
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

const thursday = [
  { title: "CS1800 Discrete Structures — Lecture", start: at(9), end: at(10, 30) },
  { title: "finish resume", start: at(11, 20), end: at(11, 50), orion: "other" },
  { title: "Review spending", start: at(14, 45), end: at(15, 30), orion: "other" },
];

function world(t, now, config = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-past-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".openclaw/orion-controlled"), { recursive: true });
  writeFileSync(join(home, "life.json"), JSON.stringify(config));
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(thursday.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const run = (...args) => {
    // A caller that names its own --date (a later day) wins over the default day.
    const own = args.includes("--date") ? [] : ["--date", DATE];
    const r = spawnSync(process.execPath, [SCRIPT, ...args, ...own], { encoding: "utf8",
      env: { ...process.env, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, ORION_LIFE_CONFIG: join(home, "life.json"),
             ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_NOW: new Date(2030, 9, 3, ...now).toISOString() } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const titles = () => JSON.parse(readFileSync(calendar, "utf8")).map((e) => `${e.title} ${e.start}`);
  return { run, titles };
}

test("a block that already ended is reported as ended, not as missing (q016)", (t) => {
  const { run, titles } = world(t, [22, 25]);
  const before = titles();
  for (const args of [["move", "Review spending", "--to", "15:05"], ["resize", "Review spending", "30"], ["swap", "Review spending", "finish resume"], ["rename", "Review spending", "budget"]]) {
    const r = run(...args);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /NOTHING WAS CHANGED: (Review spending|finish resume) already ended at \d{2}:\d{2} today/, r.out);
    assert.doesNotMatch(r.out, /no block called/, r.out);
  }
  assert.deepEqual(titles(), before);
});

test("a name that is not on the day at all is still 'no block called'", (t) => {
  const { run } = world(t, [22, 25]);
  const r = run("move", "gym", "--to", "23:00");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no block called "gym"/);
});

// Smoke test 2026-10-16: "add a 15 minute stretch block tomorrow at 7:30 am" was booked 9:32-9:47 and
// reported Done. His planning window opens an hour before his usual wake, so a stated time before it was
// "already past" and slid to the window's start. On a day that is not today nothing is past.
test("a stated time before his usual wake is kept on a later day (smoke 2026-10-16)", (t) => {
  const { run, titles } = world(t, [22, 25]);
  const r = run("add", "stretch", "15", "--at", "07:30", "--date", "2030-10-04", "--dry-run");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /planned stretch: 07:30–07:45/, r.out);
  assert.doesNotMatch(r.out, /SHIFTED|has passed/, r.out);
  assert.equal(titles().length, 3);
});

// (review, 2026-10-16) A stated 03:00 widened the window to 3 AM; the window opens at most 2 h before the usual wake.
test("a stated time more than 2 h before his usual wake is not kept (review LOW)", (t) => {
  const { run, titles } = world(t, [22, 25]);
  const r = run("add", "stretch", "15", "--at", "03:00", "--date", "2030-10-04", "--dry-run");
  assert.doesNotMatch(r.out, /planned stretch: 03:00/, r.out);
  assert.equal(titles().length, 3);
});

// Live re-run 2026-10-16 (r05): "add a 15 minute stretch block tomorrow at 7:30 am" ran
// `add Stretch 15 --at 07:30 --date tomorrow` and was booked 08:32 with "7:30 has passed". The clock was
// right (tomorrow is never behind today's clock); the 2 h cap bit: a late riser's wake (10:32) put the window's
// start at 08:32, and replan reads anything before the window as "already past". A stated time on another day
// is never past; only an absolute 05:00 floor keeps a stated 03:00 from opening the whole night.
test("a stated 07:30 tomorrow is kept for a late riser, even at 01:11 (r05)", (t) => {
  const { run } = world(t, [1, 11], { usualWake: "10:32" });
  const r = run("add", "Stretch", "15", "--at", "07:30", "--date", "2030-10-04", "--dry-run");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /planned Stretch: 07:30–07:45/, r.out);
  assert.doesNotMatch(r.out, /SHIFTED|has passed/, r.out);
});

test("the 05:00 floor still holds for a late riser (r05)", (t) => {
  const { run } = world(t, [1, 11], { usualWake: "10:32" });
  const r = run("add", "stretch", "15", "--at", "03:00", "--date", "2030-10-04", "--dry-run");
  assert.doesNotMatch(r.out, /planned stretch: 03:00/, r.out);
});

test("today: a stated time that is still ahead is kept before a late wake, one behind us is not (r05)", (t) => {
  const { run } = world(t, [1, 11], { usualWake: "10:32" });
  const ahead = run("add", "Stretch", "15", "--at", "07:30", "--dry-run");
  assert.match(ahead.out, /planned Stretch: 07:30–07:45/, ahead.out);
  const behind = world(t, [9, 0], { usualWake: "10:32" }).run("add", "Stretch", "15", "--at", "07:30", "--dry-run");
  assert.doesNotMatch(behind.out, /planned Stretch: 07:30/, behind.out);
});
