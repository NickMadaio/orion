// 2026-10-16 audit, finding 2: the morning brief was wrong ("Nothing on the calendar"
// while four blocks existed), duplicated 2 ms apart, silent, 17 min late with no
// weather, and absent on 10-13.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { composeBriefing, shouldBrief, weatherFacts } from "../scripts/lib/reach/morning.mjs";
import { claimBriefing, releaseBriefing } from "../scripts/lib/reach/morning-lock.mjs";

const m = (h, mm = 0) => h * 60 + mm;
const at = (h, mm = 0) => new Date(2026, 9, 15, h, mm);
const day1015 = [
  { title: "CS1800 Discrete Structures — Lecture", kind: "class", start: m(9), end: m(10, 30), fixed: true },
  { title: "finish resume", kind: "study", start: m(11, 20), end: m(12, 20), fixed: false },
  { title: "DS Lab", kind: "study", start: m(12, 55), end: m(13, 40), fixed: false },
  { title: "CS Lab", kind: "study", start: m(13, 45), end: m(14, 30), fixed: false },
  { title: "Review spending", kind: "other", start: m(14, 35), end: m(15, 10), fixed: false },
];

test("incident 2026-10-15: with four blocks left, the brief never says there is nothing on the calendar", () => {
  const text = composeBriefing({ now: at(10, 45), today: "2026-10-15", day: day1015, calendar: "ok" });
  assert.doesNotMatch(text, /Nothing on the calendar/i);
  assert.match(text, /finish resume at 11:20/);
  assert.match(text, /DS Lab at 12:55/);
});

test("a failed calendar read is unknown, never 'nothing'", () => {
  const text = composeBriefing({ now: at(8), today: "2026-10-15", day: [], calendar: "unknown" });
  assert.match(text, /couldn't read your calendar/i);
  assert.doesNotMatch(text, /Nothing on the calendar|nothing on today/i);
});

test("an empty read is also unknown: it says what it sees, not that the day is empty", () => {
  const text = composeBriefing({ now: at(8), today: "2026-10-15", day: [] });
  assert.doesNotMatch(text, /Nothing on the calendar/i);
  assert.match(text, /not seeing anything on your calendar/i);
});

test("a class that already happened with evidence he missed it is named kindly", () => {
  const text = composeBriefing({ now: at(10, 45), today: "2026-10-15", day: day1015, calendar: "ok", missed: [day1015[0]] });
  assert.match(text, /CS1800 Discrete Structures was at 9/);
  assert.match(text, /move the work around/);
  assert.doesNotMatch(text, /should have|missed it/i);
});

test("no weather: a fallback line instead of silence", () => {
  const text = composeBriefing({ now: at(8), today: "2026-10-15", day: day1015, calendar: "ok", weather: null });
  assert.match(text, /couldn't get the weather/i);
});

test("the day's low is the whole day's, not the remaining hours'", () => {
  const hours = [6, 7, 10, 14].map((h) => ({ time: `2026-10-15T${String(h).padStart(2, "0")}:00`, day: "today", tempC: h === 6 ? 8 : 15, rainChance: 0, rainMm: 0, snowCm: 0, code: 3 }));
  const w = weatherFacts({ hours: hours.slice(2), dayLow: 8, dayHigh: 15 }, m(10, 45));
  assert.equal(w.low, 8);
});

test("a missed run catches up once: a stale signal still briefs if nothing went out yet", () => {
  // 10-13: five signals 07:18Z-09:10Z all processed at 12:27Z and rejected as "more than 20 minutes old".
  const stale = shouldBrief({ signal: "used", signalAt: at(8), now: at(11, 30), wake: "07:45", briefedToday: false });
  assert.equal(stale.ok, true);
  assert.match(stale.reason, /catching up/);
  assert.equal(shouldBrief({ signal: "used", signalAt: at(8), now: at(11, 30), wake: "07:45", briefedToday: true }).ok, false);
  assert.match(shouldBrief({ signal: "used", signalAt: at(8), now: at(14), wake: "07:45" }).reason, /not the morning/, "never in the afternoon");
});

test("claim before gather: the second claim for the same day fails, a stale one can be taken", () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-lock-"));
  assert.equal(claimBriefing(dir, "2026-10-15", { now: 1000 }).ok, true);
  assert.equal(claimBriefing(dir, "2026-10-15", { now: 1002 }).ok, false, "2 ms later");
  assert.equal(claimBriefing(dir, "2026-10-16", { now: 1002 }).ok, true, "another day");
  assert.equal(claimBriefing(dir, "2026-10-15", { now: 1000 + 10 * 60_000 }).ok, true, "a crashed run's claim goes stale");
  releaseBriefing(dir, "2026-10-16");
  assert.equal(claimBriefing(dir, "2026-10-16", { now: 2000 }).ok, true, "released after a failure");
});

// ---- the CLI, end to end ------------------------------------------------------
const bin = (home, name, body) => { const p = join(home, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); return p; };
function harness({ calendar = "ok", weather = "ok", facts = { idleSeconds: 5, locked: false }, classNow = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-morning-"));
  const dir = join(home, "controlled"); mkdirSync(dir, { recursive: true });
  const d = new Date(2026, 9, 15); const iso = (h, mm) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mm).toISOString();
  writeFileSync(join(home, "cal.json"), JSON.stringify([
    { identifier: "cs", title: "CS1800 Discrete Structures — Lecture", start: iso(9, 0), end: iso(classNow ? 12 : 10, classNow ? 0 : 30) },
    { identifier: "r", title: "finish resume", start: iso(11, 20), end: iso(12, 20), orion: "study" }]));
  writeFileSync(join(home, "config.json"), JSON.stringify({ commuteMinutes: 45 }));
  // His alarm: pinned with a wake request so the gate does not depend on the real clock (orion-now).
  writeFileSync(join(dir, "wake-request.json"), JSON.stringify({ at: iso(7, 0) }));
  writeFileSync(join(home, "weather.json"), weather === "ok" ? JSON.stringify({ hours: [7, 9, 12, 15].map((h) => ({ time: `2026-10-15T${String(h).padStart(2, "0")}:00`, day: "today", tempC: 12, rainChance: 0, rainMm: 0, snowCm: 0, code: 3 })) }) : "FAIL");
  const failBridge = bin(home, "bridge-fail", "exit 1");
  const fakeOpen = bin(home, "fake-open", `echo "$@" >> "${home}/opened.log"`);
  const lights = bin(home, "lights", "exit 0");
  const env = { PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(home, "config.json"),
    ORION_REACH_NOW: at(7, 30).toISOString(), ORION_REACH_FACTS: JSON.stringify(facts), ORION_REACH_OPEN_BIN: fakeOpen, ORION_LIGHTS_BIN: lights,
    ORION_WEATHER_FILE: join(home, "weather.json"), ORION_BRIDGE_BIN: calendar === "ok" ? join(import.meta.dirname, "fixtures/fake-bridge.mjs") : failBridge,
    FAKE_CALENDAR: join(home, "cal.json"), ORION_SESSION_SOCKET: join(home, "no.sock") };
  const script = join(import.meta.dirname, "../scripts/orion-morning");
  const outbox = () => (existsSync(join(dir, "outreach-outbox.jsonl")) ? readFileSync(join(dir, "outreach-outbox.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const log = () => readFileSync(join(dir, "outreach.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { env, script, outbox, log, dir, home,
    run: (...a) => spawnSync(process.execPath, [script, "signal", "unplugged", "--at", at(7, 28).toISOString(), ...a], { encoding: "utf8", env }),
    runAsync: () => new Promise((res) => { const c = spawn(process.execPath, [script, "signal", "unplugged", "--at", at(7, 28).toISOString()], { env }); let out = ""; c.stdout.on("data", (x) => (out += x)); c.on("close", (code) => res({ code, out })); }) };
}

test("incident 2026-10-15 10:45: two signals at once produce exactly one brief", async () => {
  const h = harness();
  const [a, b] = await Promise.all([h.runAsync(), h.runAsync()]);
  assert.equal(h.outbox().length, 1, `${a.out} | ${b.out}`);
});

test("the brief is said aloud even when a class is on (it went out as a silent bubble)", () => {
  const h = harness({ classNow: true });
  // 7:30 is before the class: make the class current by moving the clock into it.
  h.env.ORION_REACH_NOW = at(9, 40).toISOString();
  const r = spawnSync(process.execPath, [h.script, "signal", "unplugged", "--at", at(9, 39).toISOString()], { encoding: "utf8", env: h.env });
  assert.equal(r.status, 0, r.stderr);
  const row = h.log().at(-1);
  assert.equal(row.channel, "mac-voice", `${row.reason}`);
  assert.equal(row.loud, true);
});

test("no weather: the brief is still sent, with the fallback line", () => {
  const h = harness({ weather: "fail" });
  const r = h.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(h.outbox()[0].text, /couldn't get the weather/i);
});

test("incident 2026-10-15: an unreadable calendar is never spoken as 'nothing on the calendar'", () => {
  const h = harness({ calendar: "fail" });
  h.run();
  const [line] = h.outbox();
  assert.match(line.text, /couldn't read your calendar/i);
  assert.doesNotMatch(line.text, /Nothing on the calendar/i);
});

test("a failed brief releases its claim so the next signal can try again", () => {
  const h = harness();
  mkdirSync(join(h.dir, "outreach-outbox.jsonl"), { recursive: true });   // makes orion-reach fail to deliver
  const first = h.run();
  assert.match(first.stdout, /NOT SENT/);
  assert.equal(existsSync(join(h.dir, "morning-sent.json")), false, "not recorded as briefed");
  const second = h.run();
  assert.match(second.stdout, /NOT SENT/, "it tried again rather than 'already briefed'");
});

test("incident 2026-10-13: no signal ever arrived, but he is up (WHOOP): catchup briefs once", () => {
  const h = harness();
  const wk = at(7, 10);
  writeFileSync(join(h.dir, "sleep-actual.json"), JSON.stringify({ nights: [{ fellAsleep: new Date(wk - 7 * 3600_000).toISOString(), wokeAt: wk.toISOString() }] }));
  const env = { ...h.env, ORION_REACH_NOW: at(11, 30).toISOString() };
  const first = spawnSync(process.execPath, [h.script, "catchup"], { encoding: "utf8", env });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(h.outbox().length, 1, first.stdout);
  const second = spawnSync(process.execPath, [h.script, "catchup"], { encoding: "utf8", env });
  assert.match(second.stdout, /Already briefed/);
  assert.equal(h.outbox().length, 1);
});

test("catchup with no sign he is up says nothing", () => {
  const h = harness();
  const r = spawnSync(process.execPath, [h.script, "catchup"], { encoding: "utf8", env: { ...h.env, ORION_REACH_NOW: at(11, 30).toISOString() } });
  assert.match(r.stdout, /No sign he is up/);
  assert.equal(h.outbox().length, 0);
});
