// 2026-10-16 audit findings 11 (three systems announce one class), 12 (check-in regex cancels "lab"/"macro"
// check-ins) and 13 (focus lines leak internals).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { announced, markAnnounced } from "../scripts/lib/reach/announce.mjs";
import { imminentWorthSaying } from "../scripts/lib/reach/imminent.mjs";
import { isClassAttendanceCheckin } from "../scripts/lib/life/checkin-class.mjs";
import { focusNudgeLine, strikeLine } from "../scripts/lib/focus/lines.mjs";

// ---- 11 ---------------------------------------------------------------------------
test("one key per class: whoever says it first, the others stay quiet", () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-ann-"));
  assert.equal(announced(dir, "2026-10-15", "class-540"), null);
  markAnnounced(dir, "2026-10-15", "class-540", "proactive");
  assert.equal(announced(dir, "2026-10-15", "class-540"), "proactive");
  assert.equal(announced(dir, "2026-10-16", "class-540"), null, "per day");
});

test("incident 10-15: the Discord heads-up skips what ORION planned itself, and a class already announced", () => {
  const at = new Date(2026, 9, 15, 11, 20);
  const orionKeys = new Set([`finish resume|${at.getTime()}`]);
  assert.equal(imminentWorthSaying({ at, title: "finish resume" }, { orionKeys, announced: () => null }), false, "his own movable block");
  const cs = new Date(2026, 9, 15, 9, 0);
  assert.equal(imminentWorthSaying({ at: cs, title: "CS1800 Discrete Structures — Lecture" }, { announced: () => null }), true);
  assert.equal(imminentWorthSaying({ at: cs, title: "CS1800 Discrete Structures — Lecture" }, { announced: (k) => (k === "class-540" ? "proactive" : null) }), false, "already said once");
  assert.equal(imminentWorthSaying({ at: new Date(2026, 9, 15, 19, 0), title: "Dinner with Sam" }, { announced: () => null }), true, "a fixed appointment");
});

function watchRun({ announcedBy }) {
  const home = mkdtempSync(join(tmpdir(), "orion-ann-watch-"));
  const dir = join(home, ".openclaw/orion-controlled"); mkdirSync(dir, { recursive: true });
  const d = new Date(); const iso = (h, mm) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mm).toISOString();
  writeFileSync(join(home, "cal.json"), JSON.stringify([{ identifier: "cs", title: "CS1800 Discrete Structures — Lecture", start: iso(9, 0), end: iso(10, 30) }]));
  writeFileSync(join(home, "watch.json"), JSON.stringify({ [d.toLocaleDateString("en-CA")]: { asked: ["brief", "morning"], adjusted: true, tasksPlanned: true } }));
  if (announcedBy) markAnnounced(dir, d.toLocaleDateString("en-CA"), "class-540", announcedBy);
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/orion-watch"), "tick", "--json", "--at", "08:52", "--dry-run"], { encoding: "utf8", env: {
    PATH: process.env.PATH, HOME: home, ORION_BRIDGE_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"),
    ORION_HEALTH_LOG: join(dir, "health-log.json"), ORION_WATCH_FILE: join(home, "watch.json"), ORION_SESSION_SOCKET: join(home, "none") } });
  return JSON.parse(r.stdout.trim().split("\n").at(-1));
}
test("orion-watch's class reminder is skipped when the leave nudge already went out, and sent when not", () => {
  assert.equal(watchRun({ announcedBy: "proactive" }).filter((a) => a.id.startsWith("class-")).length, 0);
  assert.equal(watchRun({ announcedBy: null }).filter((a) => a.id.startsWith("class-")).length, 1);
});

// ---- 12 ---------------------------------------------------------------------------
const classes = [{ title: "CS1800 Discrete Structures — Lecture" }, { title: "ECON1115 Macroeconomics" }, { title: "CS2100 Lab" }];
test("incident 10-02: 'lab' and 'macro' study check-ins are not cancelled as classes", () => {
  assert.equal(isClassAttendanceCheckin("start studying for macro", classes), false);
  assert.equal(isClassAttendanceCheckin("finish the DS lab write-up", classes), false);
  assert.equal(isClassAttendanceCheckin("study for ECON1115", classes), false, "a study verb wins over a course code");
});
test("a check-in about GOING to a real class is still the calendar's business", () => {
  assert.equal(isClassAttendanceCheckin("go to CS1800", classes), true);
  assert.equal(isClassAttendanceCheckin("get to ECON1115 Macroeconomics", classes), true);
});

test("orion-checkin tick: the macro check-in is kept and alerts; the class one is cancelled", () => {
  const home = mkdtempSync(join(tmpdir(), "orion-ci-"));
  const d = new Date(); const later = d.getHours() < 12 ? [20, 21] : [6, 7];
  const iso = (h) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0).toISOString();
  writeFileSync(join(home, "cal.json"), JSON.stringify([{ identifier: "e", title: "ECON1115 Macroeconomics", start: iso(later[0]), end: iso(later[1]) }]));
  const nowMin = Math.floor(Date.now() / 60000);
  const mk = (id, what) => ({ id, what, dueAt: nowMin - 5, createdAt: d.toISOString(), alerts: 0, returning: null, loop: { blockId: id, phase: "waiting", level: 0, nextCheckAt: nowMin - 5, deferrals: 0, history: [] } });
  const file = join(home, "checkins.json");
  writeFileSync(file, JSON.stringify({ checkins: [mk("ci-1", "start studying for macro"), mk("ci-2", "go to ECON1115")] }));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/orion-checkin"), "tick", "--json"], { encoding: "utf8", env: {
    PATH: process.env.PATH, HOME: home, ORION_CHECKIN_FILE: file, ORION_BRIDGE_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"),
    ORION_SESSION_SOCKET: join(home, "none") } });
  const alerts = JSON.parse(r.stdout);
  assert.deepEqual(alerts.map((a) => a.id), ["ci-1"]);
  const saved = JSON.parse(readFileSync(file, "utf8")).checkins;
  assert.equal(saved.find((c) => c.id === "ci-2").loop.phase, "cancelled");
  assert.notEqual(saved.find((c) => c.id === "ci-1").loop.phase, "cancelled");
});

// ---- 13 ---------------------------------------------------------------------------
test("incident 10-16: the focus nudge never carries debug text like 'off task for 2 min; phone use < 10 min'", () => {
  const line = focusNudgeLine({ title: "DS Lab", start: 12 * 60 + 55 });
  assert.doesNotMatch(line, /off task|phone use|<|;/);
  assert.match(line, /DS Lab/);
  assert.match(line, /12:55 PM/);
  assert.match(line, /\?/, "it asks, it offers a replan, it does not scold");
});
test("the focus-guard strike lines are sentences, never an app name used as a fragment, and never 'Enough.'", () => {
  for (const strike of [1, 2, 3]) {
    const line = strikeLine({ strike, front: "Claude", task: "do cert courses", minutesLeft: 128 });
    assert.doesNotMatch(line, /^Claude\.|Enough|Not Claude/, line);
    assert.match(line, /do cert courses/);
  }
});
