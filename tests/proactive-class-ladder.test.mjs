// 2026-10-16 audit, finding 1: he slept through CS1800 (9:00) on 2026-10-15. One
// "Leave in 12 min" banner, then silence; the afterClass line called the class "done".
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { classAttendance } from "../scripts/lib/life/attendance.mjs";
import { decide } from "../scripts/lib/reach/proactive.mjs";

const m = (h, mm = 0) => h * 60 + mm;
const cs = { id: "c1", title: "CS1800 Discrete Structures — Lecture", kind: "class", start: m(9), end: m(10, 30), fixed: true, source: "calendar" };
const travel = [{ title: "commute to class", start: m(8, 15), end: m(9) }];
const base = { bed: "23:45", wake: "07:45", day: [cs], travel, sent: {}, idleSeconds: 9999, signals: {} };

test("woke after the class started: that is evidence he missed it", () => {
  assert.equal(classAttendance(cs, { wokeAt: m(9, 29), phone: [] }), "missed");
});
test("moving away from the charger around class time: he was there", () => {
  assert.equal(classAttendance(cs, { wokeAt: m(7, 10), phone: [{ minute: m(8, 40), charging: false, motion: "walking" }] }), "attended");
});
test("no evidence either way is unknown, never attended", () => {
  assert.equal(classAttendance(cs, { wokeAt: null, phone: [] }), "unknown");
});
test("the phone sat on its charger through the class: missed", () => {
  assert.equal(classAttendance(cs, { wokeAt: null, phone: [{ minute: m(9, 10), charging: true, motion: "stationary" }] }), "missed");
});

test("ladder: leave nudge, then urgent while he has not moved, then the wake-up call", () => {
  const nudge = decide({ ...base, minute: m(8, 3) });
  assert.equal(nudge[0].key, `leave-${m(9)}`);
  assert.notEqual(nudge[0].urgent, true);
  const urgent = decide({ ...base, minute: m(8, 20), sent: { [`leave-${m(9)}`]: true } });
  assert.equal(urgent[0].key, `leave-late-${m(9)}`);
  assert.equal(urgent[0].urgent, true);
  assert.equal(urgent[0].urgentKind, "class");
  assert.match(urgent[0].text, /CS1800 Discrete Structures is at 9:00 AM/);
  const wake = decide({ ...base, minute: m(8, 50), sent: { [`leave-${m(9)}`]: true, [`leave-late-${m(9)}`]: true } });
  assert.equal(wake[0].key, `wake-${m(9)}`);
  assert.equal(wake[0].urgent, true);
  assert.equal(wake[0].loud, true);
});

test("ladder: nothing when he has already left", () => {
  const left = { ...base, signals: { leftAt: m(8, 10) } };
  assert.deepEqual(decide({ ...left, minute: m(8, 20) }), []);
  assert.deepEqual(decide({ ...left, minute: m(8, 50) }), []);
});

test("incident 2026-10-15: one kind replan after the missed class, never scolding, once", () => {
  const ctx = { ...base, minute: m(9, 35), signals: { wokeAt: m(9, 29), phone: [] },
    day: [cs, { id: "w", title: "finish resume", kind: "study", start: m(11, 20), end: m(12, 20), fixed: false }],
    sent: { [`leave-${m(9)}`]: true, [`leave-late-${m(9)}`]: true, [`wake-${m(9)}`]: true } };
  const out = decide(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, `class-missed-${m(9)}`);
  assert.match(out[0].text, /CS1800 Discrete Structures/);
  assert.match(out[0].text, /finish resume at 11:20 AM/, "what is next");
  assert.match(out[0].text, /catch up/i, "whether to catch up");
  assert.doesNotMatch(out[0].text, /should have|you missed|late again|why/i);
  assert.notEqual(out[0].urgent, true);
  assert.deepEqual(decide({ ...ctx, sent: { ...ctx.sent, [`class-missed-${m(9)}`]: true } }), []);
});

test("no missed-class message when there is no evidence he missed it", () => {
  assert.deepEqual(decide({ ...base, minute: m(9, 35), signals: {}, sent: { [`leave-${m(9)}`]: true, [`leave-late-${m(9)}`]: true, [`wake-${m(9)}`]: true } }), []);
});

// ---- orion-watch afterClass, end to end on a fake calendar --------------------
function watchAfterClass({ wokeAtMinute, phoneSignals = [] }) {
  const home = mkdtempSync(join(tmpdir(), "orion-watch-"));
  const dir = join(home, ".openclaw/orion-controlled");
  mkdirSync(dir, { recursive: true });
  const day = new Date(); const iso = (h, mm) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mm).toISOString();
  writeFileSync(join(home, "cal.json"), JSON.stringify([{ identifier: "cs1800", title: "CS1800 Discrete Structures — Lecture", start: iso(9, 0), end: iso(10, 30) }]));
  const wk = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(wokeAtMinute / 60), wokeAtMinute % 60).toISOString();
  writeFileSync(join(dir, "sleep-actual.json"), JSON.stringify({ nights: wokeAtMinute != null ? [{ fellAsleep: new Date(new Date(wk).getTime() - 7 * 3600_000).toISOString(), wokeAt: wk }] : [] }));
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ phoneSignals }));
  // The morning brief and question already went out earlier that day, as on 2026-10-15.
  writeFileSync(join(home, "watch.json"), JSON.stringify({ [day.toLocaleDateString("en-CA")]: { asked: ["brief", "morning"], adjusted: true, tasksPlanned: true } }));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/orion-watch"), "tick", "--json", "--at", "10:39", "--dry-run"], { encoding: "utf8", env: {
    PATH: process.env.PATH, HOME: home, ORION_BRIDGE_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"),
    ORION_HEALTH_LOG: join(dir, "health-log.json"), ORION_WATCH_FILE: join(home, "watch.json") } });
  return { r, alerts: JSON.parse(r.stdout.trim().split("\n").at(-1)) };
}

test("incident 2026-10-15 10:39: after a class he slept through, nothing calls it done", () => {
  const { alerts, r } = watchAfterClass({ wokeAtMinute: m(9, 29) });
  assert.equal(r.status, 0, r.stderr);
  for (const a of alerts) assert.doesNotMatch(a.text, /'s done|is done|was done/);
});

test("after a class with no evidence either way, ORION says it cannot tell instead of 'done'", () => {
  const { alerts } = watchAfterClass({ wokeAtMinute: null });
  const text = alerts.map((a) => a.text).join(" ");
  assert.match(text, /can't tell|did you make it/i);
  assert.doesNotMatch(text, /'s done/);
});

test("after a class he did attend (phone moving), 'done' is fine", () => {
  const at = new Date(); at.setHours(8, 40, 0, 0);
  const { alerts } = watchAfterClass({ wokeAtMinute: m(7, 10), phoneSignals: [{ at: at.toISOString(), charging: false, motion: "walking" }] });
  assert.match(alerts.map((a) => a.text).join(" "), /Discrete Structures is over|done/);
});

// ---- the whole tick, end to end (fake calendar, fake open, temp HOME) ---------
import { readFileSync, existsSync, chmodSync } from "node:fs";
function tick(at, { wokeAtMinute = null, extra = {} } = {}) {
  const home = extra.home ?? mkdtempSync(join(tmpdir(), "orion-tick-"));
  const dir = join(home, "controlled");
  mkdirSync(dir, { recursive: true });
  const d = new Date(at); const iso = (h, mm) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mm).toISOString();
  writeFileSync(join(home, "cal.json"), JSON.stringify([{ identifier: "cs1800", title: "CS1800 Discrete Structures — Lecture", start: iso(9, 0), end: iso(10, 30) },
    { identifier: "resume", title: "finish resume", start: iso(11, 20), end: iso(12, 20), orion: "study" }]));
  writeFileSync(join(home, "config.json"), JSON.stringify({ commuteMinutes: 45, bedtime: "00:00", usualWake: "09:00" }));
  if (wokeAtMinute != null) {
    const wk = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(wokeAtMinute / 60), wokeAtMinute % 60);
    writeFileSync(join(dir, "sleep-actual.json"), JSON.stringify({ nights: [{ fellAsleep: new Date(wk - 7 * 3600_000).toISOString(), wokeAt: wk.toISOString() }] }));
  }
  const fakeOpen = join(home, "fake-open"); writeFileSync(fakeOpen, "#!/bin/sh\nexit 0\n"); chmodSync(fakeOpen, 0o755);
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/orion-proactive"), "tick"], { encoding: "utf8", env: {
    PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(home, "config.json"), ORION_REACH_NOW: new Date(at).toISOString(),
    ORION_REACH_FACTS: JSON.stringify({ idleSeconds: 9999, locked: true }), ORION_REACH_OPEN_BIN: fakeOpen, ORION_FOCUS_HISTORY: join(dir, "focus-history.jsonl"),
    ORION_BRIDGE_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"), ORION_SESSION_SOCKET: join(home, "no.sock") } });
  const outbox = existsSync(join(dir, "outreach-outbox.jsonl")) ? readFileSync(join(dir, "outreach-outbox.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { r, outbox, home, dir };
}

test("end to end, 2026-10-15: 09:35 after a 9:29 wake, the replan goes out once", () => {
  const first = tick(new Date(2026, 9, 15, 9, 35), { wokeAtMinute: m(9, 29) });
  assert.equal(first.r.status, 0, first.r.stderr);
  assert.equal(first.outbox.length, 1, first.r.stdout);
  assert.match(first.outbox[0].text, /CS1800 Discrete Structures didn't happen today/);
  assert.match(first.outbox[0].text, /finish resume at 11:20 AM/);
  const second = tick(new Date(2026, 9, 15, 9, 40), { wokeAtMinute: m(9, 29), extra: { home: first.home } });
  assert.equal(second.outbox.length, 1, "still one: the key is said");
});

test("end to end: at leave time + 5 with no sign of him, the urgent class message goes to the phone, marked urgent", () => {
  const t = tick(new Date(2026, 9, 15, 8, 20), {});
  const urgent = t.outbox.find((l) => l.urgent === true);
  assert.ok(urgent, t.r.stdout);
  assert.equal(urgent.push, true);
  assert.match(urgent.text, /out the door/);
});
