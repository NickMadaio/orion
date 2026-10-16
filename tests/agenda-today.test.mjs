// orion-agenda today/day against a stub bridge that behaves like the real one: without `from: "today"`
// it returns only what has not ended yet. Live sweep 2026-10-15, 23:25: the day had five blocks
// (CS1800 Lecture 09:00, DS Lab 12:55, CS Lab 13:45, …) and `orion-agenda today` printed "nothing on
// the calendar today", so ORION told him "Nothing is scheduled for today" and "no lectures today".
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-agenda");
const at = (h, m = 0) => new Date(2030, 9, 2, h, m).toISOString();

// Mirrors Bridge.swift listUpcomingCalendarEvents: start = from=="today" ? start of today : now.
const STUB = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const request = JSON.parse(readFileSync(0, "utf8").trim().split("\\n")[0]);
const now = new Date(process.env.ORION_RESCHEDULE_NOW);
const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const from = request.payload?.from === "today" ? midnight : now;
const events = JSON.parse(readFileSync(process.env.STUB_CALENDAR, "utf8")).filter((e) => new Date(e.end) > from);
process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: { events_json: JSON.stringify(events) } }) + "\\n");
`;

function agenda(t, events, now) {
  const dir = mkdtempSync(join(tmpdir(), "orion-agenda-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bridge = join(dir, "bridge.mjs");
  writeFileSync(bridge, STUB, { mode: 0o755 });
  writeFileSync(join(dir, "calendar.json"), JSON.stringify(events.map((e, i) => ({ identifier: `ev-${i}`, allDay: "false", ...e }))));
  return (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8",
      env: { ...process.env, HOME: dir, ORION_BRIDGE_BIN: bridge, STUB_CALENDAR: join(dir, "calendar.json"), ORION_RESCHEDULE_NOW: now } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
}

const day = [
  { title: "CS1800 Discrete Structures — Lecture", start: at(9), end: at(10, 30) },
  { title: "DS Lab", start: at(12, 55), end: at(13, 40) },
  { title: "Review spending", start: at(14, 45), end: at(15, 30) },
];

test("q003/q025: late at night, `today` still lists the day's events, marked as already over", (t) => {
  const r = agenda(t, day, at(23, 25))("today");
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /nothing on the calendar today/, r.out);
  assert.match(r.out, /CS1800 Discrete Structures — Lecture.*\(already over/, r.out);
  assert.match(r.out, /DS Lab.*\(already over/, r.out);
  assert.match(r.out, /nothing left on the calendar today \(3 earlier\)/, r.out);
});

test("mid-day: past events are marked, the one under way says so, later ones are plain", (t) => {
  const r = agenda(t, day, at(13, 0))("today");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /CS1800[^\n]*\(already over/, r.out);
  assert.match(r.out, /DS Lab[^\n]*\(happening now, until 1:40/, r.out);
  assert.match(r.out, /Review spending\n/, r.out);
  assert.doesNotMatch(r.out, /nothing left/, r.out);
});

test("`day today` reads the whole day too", (t) => {
  const r = agenda(t, day, at(23, 25))("day", "today");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /CS1800[^\n]*\(already over/, r.out);
  assert.match(r.out, /nothing left on the calendar that day \(3 earlier\)/, r.out);
});

test("an empty day is still said plainly", (t) => {
  const r = agenda(t, [], at(10))("today");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /nothing on the calendar today/, r.out);
});

test("`upcoming` stays upcoming-only and `today --json` is unchanged (orion-focus parses it)", (t) => {
  const run = agenda(t, day, at(13, 0));
  const up = run("upcoming");
  assert.doesNotMatch(up.out, /CS1800/, up.out);
  assert.match(up.out, /DS Lab/, up.out);
  const json = JSON.parse(run("today", "--json").out);
  assert.deepEqual(json.map((e) => e.title), ["DS Lab", "Review spending"]);
});

// q041 (2026-10-16 r8): `deadlines` also lists lectures, holidays and people; --json marks which are deadlines (live-day's rule),
// so the plugin can answer "what's due this week" without the model reading the noise.
test("q041: deadlines --json marks deadline-like titles and keeps all-day", (t) => {
  const r = agenda(t, [
    { title: "Macro (ECON1115) — Quiz 1", start: at(0), end: at(23, 59), allDay: "true" },
    { title: "MKTG2201 Introduction to Marketing — Lecture", start: at(13, 30), end: at(15) },
    { title: "Annika", start: at(22, 30), end: at(23) },
    { title: "DUE 13:00 — Marketing: Slides", start: at(13), end: at(13, 30) },
  ], at(1))("deadlines", "--json");
  assert.equal(r.code, 0, r.out);
  const events = JSON.parse(r.out);
  assert.deepEqual(events.filter((e) => e.isDeadline).map((e) => e.title), ["Macro (ECON1115) — Quiz 1", "DUE 13:00 — Marketing: Slides"]);
  assert.equal(events.find((e) => /Quiz/.test(e.title)).allDay, "true");
});
