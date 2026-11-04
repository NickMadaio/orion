// 2026-11-04 (Nick: "the first thing he wants me to do is my resume? ... He also doesn't give me a single break."). His real to-dos and
// classes of that morning, run through `orion-reschedule day --todos` against a fake bridge. Never his live calendar.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { longestWorkRun } from "../scripts/lib/life/day-breaks.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-reschedule");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const DATE = "2030-11-04";
const at = (h, m = 0, dayOffset = 0) => new Date(2030, 10, 4 + dayOffset, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
const due = (offset) => at(23, 59, offset);
const hhmm = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
const label = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

const CONFIG = { readyMinutes: 105, bufferMinutes: 5, commuteMinutes: 45, minimums: { nap: 75 }, homeGapMinutes: 150, ranks: { gym: "must" },
  anchors: [{ title: "Gym", kind: "gym", minutes: 90, days: [1, 2, 3, 4, 5, 6, 7], rank: "must" }], usualWake: "08:00", bedtime: "00:00" };
const CLASSES = [
  { title: "CS1802 Discrete Structures — Seminar", start: at(9), end: at(10, 30) },
  { title: "CS2100 Program Design & Implementation 1 — Lab", start: at(11), end: at(12, 30) },
];
const TODOS = [
  { title: "finish resume", priority: "medium", due: due(-11), notes: "only schedule this once i have fully completed the \"do cert courses\" task.\nTags: internship\nOrder: 0" },
  { title: "send internship applications", priority: "low", notes: "Dont schedule unless \"finish resume\" is completed\nOrder: 3" },
  { title: "Student oyster card", priority: "medium", notes: "Tags: misc\nOrder: 2" },
  { title: "DS Lab 05", priority: "medium", due: due(-5), notes: "Tags: school" },
  { title: "CS Lab", priority: "high", notes: "Tags: school" },
  { title: "GET A GP", priority: "high", due: due(-2), notes: "Tags: misc" },
  { title: "New CS Lab", priority: "medium", due: due(5), notes: "Tags: school" },
];

function world(t, { config = CONFIG, todos = TODOS, events = CLASSES, now = [8, 0] } = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-rank-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, ".openclaw/orion-controlled"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(home, "life.json"), JSON.stringify(config));
  writeFileSync(join(home, "calendar.json"), JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  writeFileSync(join(home, "reminders.json"), JSON.stringify(todos.map((r, i) => ({ identifier: `R${i}-ID`, list: "Orion", ...r }))));
  const nowIso = new Date(2030, 10, 4, now[0], now[1]).toISOString();
  const run = (...extra) => {
    const r = spawnSync(process.execPath, [SCRIPT, "day", "--todos", "--date", DATE, ...extra], { encoding: "utf8",
      env: { ...process.env, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: join(home, "calendar.json"), FAKE_REMINDERS: join(home, "reminders.json"),
        ORION_LIFE_CONFIG: join(home, "life.json"), ORION_RESCHEDULE_UNDO: join(home, "u.json"), ORION_RESCHEDULE_PINS: join(home, "p.json"),
        ORION_RESCHEDULE_NOW: nowIso, ORION_REACH_NOW: nowIso } });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const plan = () => JSON.parse(readFileSync(join(home, "calendar.json"), "utf8")).map((e) => ({ title: e.title, start: hhmm(e.start), end: hhmm(e.end), kind: e.orion ?? "class" }))
    .sort((a, b) => a.start - b.start);
  const reasons = () => { try { return JSON.parse(readFileSync(join(dir, "plan-reasons.json"), "utf8")); } catch { return null; } };
  return { run, plan, reasons, dir };
}
const todoOrder = (plan) => plan.filter((b) => TODOS.some((t) => t.title === b.title)).map((b) => b.title);

test("today's real list: the resume is not first; due and high-priority coursework come first", (t) => {
  const w = world(t);
  const r = w.run();
  assert.equal(r.code, 0, r.out);
  if (process.env.SHOW) console.log(r.out);
  const order = todoOrder(w.plan());
  assert.notEqual(order[0], "finish resume", order.join(" > "));
  const at = (x) => order.indexOf(x);
  assert.ok(at("GET A GP") < at("finish resume"));
  assert.ok(at("DS Lab 05") < at("finish resume"));
  assert.ok(at("CS Lab") < at("finish resume"));
  assert.ok(at("GET A GP") < at("DS Lab 05"), `high and overdue leads: ${JSON.stringify(w.plan().map((b) => `${b.title} ${label(b.start)}`))}`);
  assert.equal(order.includes("send internship applications"), false, "still waits for the resume");
});

test("breaks exist, a lunch is there, and no run of work passes two hours", (t) => {
  const w = world(t);
  const r = w.run();
  assert.equal(r.code, 0, r.out);
  const plan = w.plan();
  assert.ok(plan.filter((b) => b.title === "Break").length >= 1, `no break: ${JSON.stringify(plan)}`);
  assert.ok(plan.some((b) => b.title === "Lunch"), "no lunch");
  assert.ok(longestWorkRun(plan.map((b) => ({ ...b, kind: b.title === "Break" || b.title === "Lunch" || b.title === "Dinner" ? "rest" : "study" }))) <= 120);
  const s = [...plan]; s.slice(1).forEach((b, i) => assert.ok(b.start >= s[i].end, `${s[i].title} overlaps ${b.title}`));
  for (const c of plan.filter((b) => /^CS(1802|2100)/.test(b.title))) assert.equal(CLASSES.some((e) => hhmm(e.start) === c.start), true, "classes stay put");
});

test("the plan says why: each planned to-do carries its reason for the 'why is X first' answer", (t) => {
  const w = world(t);
  assert.equal(w.run().code, 0);
  const saved = w.reasons();
  assert.ok(saved, "plan-reasons.json written");
  assert.equal(saved.date, DATE);
  const first = [...saved.items].filter((i) => i.start !== undefined).sort((a, b) => a.start - b.start)[0];
  assert.equal(first.title, "GET A GP");
  assert.match(first.reason, /overdue since .* and high priority/);
  assert.match(w.run("--dry-run").out, /GET A GP.*first|first.*GET A GP|because/i, "the reply carries the reason");
});

test("a to-do due tonight leads the day and its reason says tonight", (t) => {
  const todos = [...TODOS, { title: "AE1 slides", priority: "medium", due: due(0), notes: "Tags: school" }];
  const w = world(t, { todos });
  assert.equal(w.run().code, 0);
  const first = w.reasons().items.filter((i) => i.start !== undefined).sort((a, b) => a.start - b.start)[0];
  assert.equal(first.title, "AE1 slides", JSON.stringify(w.reasons().items));
  assert.match(first.reason, /due tonight/);
});

test("effort fits the gap: the long top item waits for a gap it fits while a short one uses the small gap before a fixed event", (t) => {
  const todos = [{ title: "big essay draft, 2 hours", priority: "high", due: due(0), notes: "Tags: school" }, { title: "quick email, 15 minutes", priority: "low" }];
  const w = world(t, { todos, now: [9, 30], events: [{ title: "Dentist appointment", start: at(11), end: at(11, 30) }], config: { ...CONFIG, usualWake: "06:00" } });
  const r = w.run();
  assert.equal(r.code, 0, r.out);
  const plan = w.plan();
  const essay = plan.find((b) => /essay/.test(b.title)); const email = plan.find((b) => /email/.test(b.title));
  assert.ok(essay && email, JSON.stringify(plan));
  assert.ok(essay.start >= 11 * 60 + 30, `essay after the appointment: ${label(essay.start)}`);
  assert.ok(email.end <= 11 * 60, `email in the gap before it: ${label(email.end)}`);
});

test("breaks are configurable and can be turned off; --no-breaks leaves the old plan", (t) => {
  const off = world(t, { config: { ...CONFIG, planBreaks: { enabled: false } } });
  assert.equal(off.run().code, 0);
  assert.equal(off.plan().some((b) => /^(Break|Lunch|Dinner|Transition)$/.test(b.title)), false);
  const flag = world(t);
  assert.equal(flag.run("--no-breaks").code, 0);
  assert.equal(flag.plan().some((b) => /^(Break|Lunch|Dinner|Transition)$/.test(b.title)), false);
  const short = world(t, { config: { ...CONFIG, planBreaks: { breakMinutes: 10, lunch: { minutes: 30 } } } });
  assert.equal(short.run().code, 0);
  const lunch = short.plan().find((b) => b.title === "Lunch");
  assert.equal(lunch.end - lunch.start, 30);
});

test("dry run writes nothing, not even the reasons", (t) => {
  const w = world(t);
  assert.equal(w.run("--dry-run").code, 0);
  assert.equal(w.reasons(), null);
  assert.equal(w.plan().length, CLASSES.length);
});

test("a plan laid down in the wrong order is ranked again: the resume that sat first for days no longer does, and no block is doubled", (t) => {
  const mine = (title, s, e) => ({ title, start: at(...s), end: at(...e), orion: "other", orionTags: "other" });
  const events = [...CLASSES, mine("finish resume", [13, 20], [14, 50]), mine("DS Lab 05", [14, 55], [15, 40]), mine("GET A GP", [15, 45], [16, 30])];
  const w = world(t, { events });
  const r = w.run();
  assert.equal(r.code, 0, r.out);
  const plan = w.plan();
  const order = todoOrder(plan);
  assert.equal(order[0], "GET A GP", order.join(" > ") + r.out);
  assert.ok(order.indexOf("finish resume") > order.indexOf("DS Lab 05"));
  for (const title of TODOS.map((x) => x.title)) assert.ok(plan.filter((b) => b.title === title).length <= 1, `${title} doubled`);
  assert.doesNotMatch(r.out, /cleared \d+ prior/);
  const again = w.run();   // a second run is stable: no stacked breaks
  if (process.env.SHOW) console.log(r.out, "\n--- second ---\n", again.out);
  assert.equal(again.code, 0, again.out);
  const after = w.plan();
  assert.equal(after.filter((b) => b.title === "Lunch").length, 1);
  assert.deepEqual(todoOrder(after), order);
});
