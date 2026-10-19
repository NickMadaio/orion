// 2026-10-19 CS Lab incident, script side (docs/audits/2026-10-19-cslab-incident.md). Fixtures only: a fake bridge and a temp home.
//   e) `log "cs lab"` over the planned CS Lab and a Gym that was already under way: no "no room" slip for a thing he did, and the Gym's
//      remaining minutes stay where they are (a past log never knocks a must out of the rest of the day)
//   c) the review counts what `log` wrote, even when the bridge drops the `logged` tag (the 10-06 build) or the calendar loses the block
//   d) the blank ask does not offer, or ask over, something he just logged
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { actualDay, actualText } from "../scripts/lib/life/day-review.mjs";
import { withLoggedLedger, markLoggedEvents } from "../scripts/lib/life/logged.mjs";
import { blankAsk, JUST_LOGGED_MINUTES } from "../scripts/lib/curiosity/decide.mjs";
import { emptyLedger } from "../scripts/lib/curiosity/ledger.mjs";
import { aw } from "./fixtures/curiosity-aw.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RESCHEDULE = join(ROOT, "scripts/orion-reschedule");
const REVIEW = join(ROOT, "scripts/orion-day-review");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const DATE = "2030-10-03";
const at = (h, m = 0) => new Date(2030, 9, 3, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
const m = (h, mm = 0) => h * 60 + mm;

function world(t, events) {
  const home = mkdtempSync(join(tmpdir(), "orion-cslab-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const controlled = join(home, ".openclaw/orion-controlled");
  mkdirSync(controlled, { recursive: true });
  writeFileSync(join(home, "life.json"), "{}");
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const env = (now) => ({ ...process.env, HOME: home, ORION_CONTROLLED_DIR: controlled, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: calendar, ORION_LIFE_CONFIG: join(home, "life.json"),
    ORION_RESCHEDULE_UNDO: join(home, "undo.json"), ORION_RESCHEDULE_PINS: join(home, "pins.json"),
    ORION_RESCHEDULE_NOW: new Date(2030, 9, 3, ...now).toISOString(), ORION_REACH_NOW: new Date(2030, 9, 3, ...now).toISOString() });
  const run = (now, ...args) => {
    const r = spawnSync(process.execPath, [RESCHEDULE, ...args, "--date", DATE], { encoding: "utf8", env: env(now) });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const review = (now) => JSON.parse(spawnSync(process.execPath, [REVIEW, "--json", "--date", DATE], { encoding: "utf8", env: env(now) }).stdout);
  const cal = () => JSON.parse(readFileSync(calendar, "utf8"));
  const save = (list) => writeFileSync(calendar, JSON.stringify(list));
  const jsonl = (f) => (existsSync(join(controlled, f)) ? readFileSync(join(controlled, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { run, review, cal, save, jsonl };
}

// Tonight's day (BST clock times, a fixture date): a lecture, the CS Lab ORION planned 17:50-18:35, the Gym 20:20-21:50 (a must), Annika at 22:30.
const events = [
  { title: "CS1800 Discrete Structures — Lecture", start: at(11), end: at(12, 30) },
  { title: "CS Lab", start: at(17, 50), end: at(18, 35), orion: "study", orionTags: "study" },
  { title: "Gym", start: at(20, 20), end: at(21, 50), orion: "gym", orionTags: "gym" },
  { title: "Annika", start: at(22, 30), end: at(23, 30) },
];
const LOG = ["log", "cs lab", "--from", "17:50", "--to", "now"];

test("e: 'log cs lab' over the planned CS Lab is not a slip, and the Gym already under way keeps its remaining minutes", (t) => {
  const w = world(t, events);
  const r = w.run([21, 0], ...LOG);
  assert.equal(r.code, 0, r.out);
  const titles = w.cal().map((e) => `${e.title} ${e.start}–${e.end}`);
  assert.ok(titles.includes(`cs lab ${at(17, 50)}–${at(21)}`), titles.join("\n"));
  assert.ok(!w.cal().some((e) => e.title === "CS Lab"), "the planned CS Lab is the one he did: gone, not re-entered");
  const gym = w.cal().find((e) => e.title === "Gym");
  assert.ok(gym, "the Gym is still on the calendar");
  assert.equal(gym.start, at(21)); assert.equal(gym.end, at(21, 50));
  const slips = w.jsonl("slips.jsonl");
  assert.ok(!slips.some((s) => s.planned.title === "CS Lab"), "no slip for the thing he did");
  assert.ok(!slips.some((s) => s.reason === "no-room"), JSON.stringify(slips));
  assert.deepEqual(slips.map((s) => [s.planned.title, s.reason, s.missedMinutes]), [["Gym", "reality", 40]]);
  const said = r.out.trim().split("\n").at(-1);
  assert.doesNotMatch(said, /no room/i);
  assert.match(said, /^Logged cs lab 5:50-9\./);
  assert.match(said, /Gym is now 9-9:50/);
});

test("the log writes its own ledger row, and undo takes it back with the block", (t) => {
  const w = world(t, events);
  assert.equal(w.run([21, 0], ...LOG).code, 0);
  const rows = w.jsonl("logged.jsonl");
  assert.equal(rows.length, 1);
  const created = w.cal().find((e) => e.title === "cs lab");
  assert.deepEqual({ title: rows[0].title, date: rows[0].date, start: rows[0].start, end: rows[0].end, identifier: rows[0].identifier },
    { title: "cs lab", date: DATE, start: m(17, 50), end: m(21), identifier: created.identifier });
  assert.match(w.run([21, 5], "undo").out, /Undone/);
  assert.deepEqual(w.jsonl("logged.jsonl"), []);
  assert.deepEqual(w.jsonl("slips.jsonl"), []);
});

test("c: the review counts the logged block when the bridge dropped the `logged` tag (the 10-06 bridge)", (t) => {
  const w = world(t, events);
  assert.equal(w.run([21, 0], ...LOG).code, 0);
  // what the old bridge does: it keeps the title and the kind marker and loses every other tag
  w.save(w.cal().map((e) => (e.title === "cs lab" ? { ...e, orionTags: "study" } : e)));
  const out = w.review([22, 3]);
  assert.deepEqual(out.done.filter((d) => d.how === "logged").map((d) => [d.title, d.start, d.end]), [["cs lab", m(17, 50), m(21)]]);
  assert.doesNotMatch(out.text, /Nothing logged/);
  assert.match(out.text, /^Today: cs lab 5:50-9/);
  assert.doesNotMatch(out.text, /CS Lab \(no room\)|Gym \(no room\)/);
});

test("c: ...and when the calendar no longer has the block at all (it was gone within the hour tonight)", (t) => {
  const w = world(t, events);
  assert.equal(w.run([21, 0], ...LOG).code, 0);
  w.save(w.cal().filter((e) => e.title !== "cs lab"));
  const out = w.review([22, 3]);
  assert.deepEqual(out.done.filter((d) => d.how === "logged").map((d) => d.title), ["cs lab"]);
  assert.doesNotMatch(out.text, /Nothing logged/);
  assert.ok(!out.blank.some((b) => b.start < m(17, 50) + 1 && b.end > m(18)), "17:50-21:00 is not 'unknown'");
});

test("the ledger helpers: a row marks its event, and shows only when the calendar lacks it", () => {
  const row = { date: DATE, txn: "log-x", identifier: "id-1", title: "cs lab", kind: "study", start: m(17, 50), end: m(21) };
  const [marked] = markLoggedEvents([{ identifier: "id-1", title: "cs lab", orion: "study", orionTags: "" }, { identifier: "id-2", title: "x" }].slice(0, 1), new Set(["id-1"]));
  assert.equal(marked.orionTags, "study,logged");
  const onCal = [{ id: "a", calendarId: "id-1", title: "cs lab", start: m(17, 50), end: m(21), logged: true }];
  assert.equal(withLoggedLedger(onCal, DATE, [row]).length, 1, "present on the calendar: not doubled");
  const gone = withLoggedLedger([], DATE, [row]);
  assert.deepEqual(gone.map((b) => [b.title, b.logged, b.calendarId]), [["cs lab", true, null]]);
});

test("c: a slip that says CS Lab was replaced by cs lab is not 'Slipped' in the review", () => {
  const cs = { id: "l", title: "cs lab", kind: "study", start: m(17, 50), end: m(21), fixed: false, source: "orion", logged: true };
  const a = actualDay({ blocks: [cs], now: { date: DATE, minute: m(22, 3) },
    slips: [{ date: DATE, planned: { title: "CS Lab", start: m(16, 50), end: m(17, 35), kind: "study", rank: "high" }, missedMinutes: 45, replacedBy: "cs lab", reason: "no-room" }] });
  assert.deepEqual(a.slipped, []);
  assert.doesNotMatch(actualText(a), /Slipped/);
});

test("d: the blank ask never offers a to-do he already logged, and waits after a fresh log", () => {
  const T = new Date(2026, 9, 19, 21, 53);
  const day = [{ id: "l", title: "cs lab", kind: "study", start: m(17, 50), end: m(21), fixed: false, source: "orion", logged: true }];
  const over = { calendar: { freeUntil: m(22, 30), next: { title: "Annika", start: m(22, 30) } } };
  const ctx = { minute: m(21, 53), date: "2026-10-19", day, todos: [{ title: "CS Lab", dueDate: "2026-10-19" }], ledger: emptyLedger(), now: T.getTime() };
  const asked = blankAsk(aw(T, over), ctx);
  assert.equal(asked.type, "home-gap");
  assert.match(asked.text, /^Nothing planned till 10:30 - what are you up to\? Want me to put something there\?$/);
  assert.doesNotMatch(asked.text, /CS Lab/);
  assert.equal(asked.ask.window.start, m(21), "the blank starts when the logged block ends, not at 17:00");
  // a log made minutes ago is an answer already: no "what are you up to?" over it
  const fresh = new Date(2026, 9, 19, 21, 10);
  const justNow = [{ ...day[0], end: m(21, 5) }];
  assert.equal(blankAsk(aw(fresh, over), { ...ctx, minute: m(21, 10), day: justNow, now: fresh.getTime() }), null);
  assert.ok(JUST_LOGGED_MINUTES >= 30);
});

test("a title match is by whole words: logging 'party' does not fulfil a planned 'Art', and 'lab' is not 'Study for quiz'", (t) => {
  const party = { id: "p", title: "party", kind: "other", start: m(18), end: m(20), fixed: false, source: "orion", logged: true };
  const a = actualDay({ blocks: [party], now: { date: DATE, minute: m(22) },
    slips: [{ date: DATE, planned: { title: "Art", start: m(18), end: m(19), kind: "other", rank: "medium" }, missedMinutes: 60, replacedBy: "party", reason: "no-room" },
            { date: DATE, planned: { title: "Study for quiz", start: m(20), end: m(21), kind: "study", rank: "high" }, missedMinutes: 60, replacedBy: "lab", reason: "no-room" }] });
  assert.deepEqual(a.slipped.map((s) => s.title), ["Art", "Study for quiz"]);
  const w = world(t, [{ title: "art", start: at(18), end: at(19), orion: "other", orionTags: "other" }]);
  assert.equal(w.run([20, 0], "log", "party", "--from", "18:00", "--to", "now").code, 0);
  assert.deepEqual(w.jsonl("slips.jsonl").map((s) => s.planned.title), ["art"], "art was displaced by party, not fulfilled by it");
});

test("ORION's blocks are written to the calendar named in his config, not the default one (the synced School feed removed them in 45 s)", (t) => {
  const w = world(t, events);
  assert.equal(w.run([21, 0], ...LOG).code, 0);
  const made = w.cal().filter((e) => e.title === "cs lab" || e.title === "Gym");
  assert.ok(made.length > 0);
  for (const e of w.cal().filter((x) => x.title === "cs lab")) assert.equal(e.calendar, "Calendar");
});
