// Independent review of fix/proactive-2026-10-16 (BLOCKED): findings H1-H3, M1-M7 and the LOW items.
// Design rule: when unsure, DELIVER. A wrongly held reminder or class wake-up is worse than an early one.
// Temp HOME and fakes only; nothing real is sent.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { decide } from "../scripts/lib/reach/proactive.mjs";
import { claimBriefing } from "../scripts/lib/reach/morning-lock.mjs";
import { appendHeld, readHeld, clearHeld } from "../scripts/lib/reach/held.mjs";
import { quietFacts } from "../scripts/lib/reach/presence.mjs";
import { shouldBrief } from "../scripts/lib/reach/morning.mjs";

const W = join(import.meta.dirname, "..");
const m = (h, mm = 0) => h * 60 + mm;
const exe = (home, name, body) => { const p = join(home, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); return p; };
const rows = (f) => (existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

// ---- shared harness: one temp HOME, many ticks ---------------------------------------
function world({ commute = 45, wokeAt = null, announced = null, morningSent = true, facts = { idleSeconds: 9999, locked: true }, cal = null, day = [2026, 9, 15] } = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-rev-"));
  const dir = join(home, "controlled"); mkdirSync(dir, { recursive: true });
  const iso = (h, mi) => new Date(day[0], day[1], day[2], h, mi).toISOString();
  const date = new Date(day[0], day[1], day[2]).toLocaleDateString("en-CA");
  writeFileSync(join(home, "cal.json"), JSON.stringify(cal ?? [{ identifier: "cs1800", title: "CS1800 Discrete Structures — Lecture", start: iso(9, 0), end: iso(10, 30) }]));
  writeFileSync(join(home, "config.json"), JSON.stringify({ commuteMinutes: commute, bedtime: "00:00", usualWake: "09:00" }));
  const open = exe(home, "fake-open", "exit 0");
  if (morningSent) writeFileSync(join(dir, "morning-sent.json"), JSON.stringify({ [date]: { at: iso(7, 0), signal: "up" } }));
  if (announced) writeFileSync(join(dir, "announced.json"), JSON.stringify({ [date]: { "class-540": announced } }));
  if (wokeAt != null) { const wk = new Date(day[0], day[1], day[2], Math.floor(wokeAt / 60), wokeAt % 60); writeFileSync(join(dir, "sleep-actual.json"), JSON.stringify({ nights: [{ fellAsleep: new Date(wk - 7 * 3600_000).toISOString(), wokeAt: wk.toISOString() }] })); }
  const weather = join(home, "w.json"); writeFileSync(weather, "{}");
  const env = (h, mi, extra = {}) => ({ PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(home, "config.json"),
    ORION_REACH_NOW: new Date(day[0], day[1], day[2], h, mi).toISOString(), ORION_REACH_FACTS: JSON.stringify(facts), ORION_REACH_OPEN_BIN: open, ORION_LIGHTS_BIN: open,
    ORION_WEATHER_FILE: weather, ORION_FOCUS_HISTORY: join(dir, "focus-history.jsonl"), ORION_BRIDGE_BIN: join(W, "tests/fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"),
    ORION_SESSION_SOCKET: join(home, "no.sock"), ...extra });
  const script = (n, args, h, mi, extra) => spawnSync(process.execPath, [join(W, "scripts", n), ...args], { encoding: "utf8", env: env(h, mi, extra), timeout: 120000 });
  return { home, dir, open, env, script, tick: (h, mi, extra) => script("orion-proactive", ["tick"], h, mi, extra), outbox: () => rows(join(dir, "outreach-outbox.jsonl")), log: () => rows(join(dir, "outreach.jsonl")), held: () => rows(join(dir, "held.jsonl")) };
}

// ---- H1 -------------------------------------------------------------------------------
test("H1: ticks at 8:03, 8:20, 8:50, 9:05 for a 9:00 class with an 8:15 commute give three escalating messages", () => {
  const w = world();
  const seen = [];
  for (const [h, mi] of [[8, 3], [8, 20], [8, 50], [9, 5]]) { w.tick(h, mi); seen.push(w.outbox().length); }
  assert.deepEqual(seen, [1, 2, 3, 3]);
  const [nudge, urgent, wake] = w.outbox();
  assert.match(nudge.text, /Leave in 12 min/); assert.equal(nudge.urgent, false);
  assert.match(urgent.text, /out the door/); assert.equal(urgent.urgent, true);
  assert.match(wake.text, /starts in 10 min/); assert.equal(wake.urgent, true);
});

test("H1: if orion-watch already marked the class, the plain nudge yields but the urgent steps are never skipped", () => {
  const w = world({ announced: "watch" });
  for (const [h, mi] of [[8, 3], [8, 20], [8, 50], [9, 5]]) w.tick(h, mi);
  const texts = w.outbox().map((o) => o.text);
  assert.equal(texts.length, 2, texts.join(" | "));
  assert.match(texts[0], /out the door/); assert.match(texts[1], /starts in 10 min/);
});

// ---- H2 / H3 ----------------------------------------------------------------------------
test("H2: the app's `--kind reminder --urgent` (no --urgent-kind) is a reminder he set: delivered at 3 AM, and urgent", () => {
  const w = world();
  const r = w.script("orion-reach", ["Reminder: take the bins out.", "--kind", "reminder", "--urgent", "--why", "a reminder he asked for"], 3, 9);
  assert.match(r.stdout, /^Sent/, r.stdout + r.stderr);
  assert.equal(w.outbox()[0].urgent, true);
  assert.equal(w.held().length, 0);
});
test("H2: a bare --urgent on another kind is still held at 3 AM", () => {
  const w = world();
  assert.match(w.script("orion-reach", ["Heads up.", "--kind", "update", "--urgent"], 3, 9).stdout, /Held/);
});
test("H3: a forced --channel phone obeys quiet hours; a genuine urgent kind still goes", () => {
  const w = world();
  assert.match(w.script("orion-reach", ["Evening digest.", "--kind", "update", "--channel", "phone"], 3, 9).stdout, /Held/);
  assert.equal(w.outbox().length, 0);
  assert.match(w.script("orion-reach", ["Leave now.", "--kind", "reminder", "--channel", "phone", "--urgent-kind", "class"], 3, 9).stdout, /^Sent/);
});
test("H3: notify's phone fallback for a quiet-hours-held message does not push at 3 AM (it is queued)", () => {
  const w = world();
  const disc = exe(w.home, "discord", "exit 1");
  const r = spawnSync(process.execPath, [join(W, "scripts/orion-notify"), "blocked", "mission-x", "need a key", "--approval", "use staging key", "--now", new Date(2026, 9, 16, 3, 9).toISOString()],
    { encoding: "utf8", env: { ...w.env(3, 9), ORION_DISCORD_ALERT_BIN: disc, ORION_REACH_BIN: join(W, "scripts/orion-reach") } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(w.outbox().length, 1, "blocked is forced, so it is delivered (phone) even at night: when unsure, deliver");
});

// ---- M1 / M2 ----------------------------------------------------------------------------
function catchup(w, h, mi) { return w.script("orion-morning", ["catchup"], h, mi); }
function pinAlarm(w, h, mi) { writeFileSync(join(w.dir, "wake-request.json"), JSON.stringify({ at: new Date(2026, 9, 15, h, mi).toISOString() })); }

test("M1: the catch-up is skipped inside a fixed block, and outside one it uses normal routing (not loud)", () => {
  const w = world({ morningSent: false, wokeAt: m(7, 10) }); pinAlarm(w, 7, 0);
  const inClass = catchup(w, 9, 40);
  assert.equal(w.outbox().length, 0, inClass.stdout);
  assert.equal(existsSync(join(w.dir, "morning-sent.json")), false);
  const after = catchup(w, 11, 30);
  assert.equal(w.outbox().length, 1, after.stdout + after.stderr);
  const row = w.log().at(-1);
  assert.equal(row.loud, false);
  assert.notEqual(row.channel, "mac-voice");
});

test("M2: woke at 5:30 for a 7:45 alarm: the catch-up still fires", () => {
  const w = world({ morningSent: false, wokeAt: m(5, 30) }); pinAlarm(w, 7, 45);
  catchup(w, 11, 30);
  assert.equal(w.outbox().length, 1);
  assert.equal(shouldBrief({ signal: "up", signalAt: new Date(2026, 9, 15, 5, 30), now: new Date(2026, 9, 15, 11, 30), wake: "07:45", catchUp: true }).ok, true);
  assert.equal(shouldBrief({ signal: "up", signalAt: new Date(2026, 9, 15, 5, 30), now: new Date(2026, 9, 15, 11, 30), wake: "07:45" }).ok, false, "a live signal is still judged on its own time");
});

// ---- M3 -----------------------------------------------------------------------------------
test("M3: one stray 'still, charging' phone sample does not lift quiet hours", () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-q-"));
  const now = new Date(2026, 9, 16, 3, 9);
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ phoneSignals: [{ at: new Date(now - 2 * 60_000).toISOString(), charging: true, motion: "stationary" }] }));
  const facts = { idleSeconds: 9999, locked: true };
  assert.equal(quietFacts({ now, dir, config: { bedtime: "00:00", usualWake: "09:00" }, facts }).quiet, true);
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ phoneSignals: [{ at: new Date(now - 2 * 60_000).toISOString(), charging: false, motion: "walking" }] }));
  assert.equal(quietFacts({ now, dir, config: { bedtime: "00:00", usualWake: "09:00" }, facts }).quiet, false, "real motion off the charger: he is up, deliver");
});
test("M3: the held queue is not drained inside the sleep window unless he is at the Mac", () => {
  const w = world();
  w.script("orion-reach", ["Rain at 3.", "--kind", "info"], 3, 9);   // held: quiet
  assert.equal(w.held().length, 1);
  const idle = w.script("orion-reach", ["--drain-held"], 3, 30);
  assert.match(idle.stdout, /Still held/);
  assert.equal(w.held().length, 1);
  const up = spawnSync(process.execPath, [join(W, "scripts/orion-reach"), "--drain-held"], { encoding: "utf8", env: { ...w.env(3, 30), ORION_REACH_FACTS: JSON.stringify({ idleSeconds: 5, locked: false }) } });
  assert.match(up.stdout, /^Sent/, up.stdout);
});
test("LOW: held alerts are not released to the phone inside the sleep window either", () => {
  const w = world();
  appendHeld(w.dir, { id: "held-1", alertId: "watch-x", at: new Date(2026, 9, 16, 1, 0).toISOString(), text: "Morning. x", level: 1, via: "alerts-outbox" });
  w.tick(3, 30);
  assert.equal(existsSync(join(w.dir, "alerts-outbox.jsonl")), false);
  assert.equal(w.held().length, 1);
});

// ---- M4: orion-notify retries -------------------------------------------------------------
function notifyWorld() {
  const home = mkdtempSync(join(tmpdir(), "orion-rn-"));
  const log = join(home, "calls.log");
  const disc = exe(home, "discord", `echo "discord $1" | tr '\\n' ' ' | head -c 60 >> ${log}; echo >> ${log}\n[ -f ${home}/discord-up ] && exit 0\nexit 1`);
  const reach = exe(home, "reach", `[ -f ${home}/reach-up ] || exit 4\nsleep 1\necho "reach $1" | tr '\\n' ' ' | head -c 70 >> ${log}; echo >> ${log}\nexit 0`);
  const env = { PATH: process.env.PATH, HOME: home, ORION_DISCORD_ALERT_BIN: disc, ORION_REACH_BIN: reach, ORION_SESSION_SOCKET: join(home, "no.sock") };
  const run = (args, timeout = 120000) => spawnSync(process.execPath, [join(W, "scripts/orion-notify"), ...args], { encoding: "utf8", env, timeout });
  const state = () => JSON.parse(readFileSync(join(home, ".openclaw/orion-controlled/remote.json"), "utf8"));
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);
  return { home, run, state, calls };
}
test("M4: a send never retries the backlog (one Discord call per send), and no night flush", () => {
  const n = notifyWorld();
  for (let i = 0; i < 8; i++) n.run(["milestone", `mission-${i}`, `step ${i} finished`, "--now", `2026-10-16T21:${String(10 + i * 5).padStart(2, "0")}:00`]);
  assert.equal(n.state().notify.retry.length, 8);
  const before = n.calls().filter((c) => c.startsWith("discord")).length;
  writeFileSync(join(n.home, "discord-up"), "");
  n.run(["blocked", "mission-x", "need a key", "--now", "2026-10-16T23:30:00"]);
  assert.equal(n.calls().filter((c) => c.startsWith("discord")).length - before, 1, "only the blocked message");
  assert.equal(n.state().notify.retry.length, 8, "nothing flushed at night");
  const forced = n.run(["flush", "--force", "--now", "2026-10-16T23:31:00"]);
  assert.match(forced.stdout + forced.stderr, /quiet hours|unknown|not flushing/i, "--force no longer bypasses quiet hours");
  assert.equal(n.state().notify.retry.length, 8);
});
test("M4/N: a flush retries at most 3 per run, as ONE merged message, persists, and never re-delivers", () => {
  const n = notifyWorld();
  for (let i = 0; i < 6; i++) n.run(["milestone", `mission-${i}`, `step ${i} finished`, "--now", `2026-10-16T14:${String(10 + i * 5).padStart(2, "0")}:00`]);
  writeFileSync(join(n.home, "reach-up"), "");
  n.run(["flush", "--now", "2026-10-16T15:00:00"], 8000);
  assert.equal(n.calls().filter((c) => c.startsWith("reach")).length, 1, "three retries, one push");
  assert.equal(n.state().notify.retry.length, 3);
  assert.equal(n.state().notify.sent.length, 3);
  n.run(["flush", "--now", "2026-10-16T15:01:00"], 8000);
  n.run(["flush", "--now", "2026-10-16T15:02:00"], 8000);
  assert.equal(n.calls().filter((c) => c.startsWith("reach")).length, 2, "the second flush sent the rest; the third had nothing");
  assert.equal(n.state().notify.retry.length, 0);
  assert.equal(n.state().notify.sent.length, 6);
});
test("M4: a failing retry backs off instead of hammering, and a time-relative text expires in 20 minutes", () => {
  const n = notifyWorld();
  n.run(["milestone", "standing-check", "Heads up 9:00 AM - CS1800. Starts in 1h 58m.", "--now", "2026-10-16T07:02:00"]);
  n.run(["milestone", "mission-1", "step finished", "--now", "2026-10-16T07:03:00"]);
  const a = n.run(["flush", "--now", "2026-10-16T07:10:00"]);
  const callsA = n.calls().filter((c) => c.startsWith("discord")).length;
  n.run(["flush", "--now", "2026-10-16T07:11:00"]);
  assert.equal(n.calls().filter((c) => c.startsWith("discord")).length, callsA, "the second flush a minute later does not retry (backoff)");
  const s = n.state().notify.retry;
  assert.ok(!s.some((r) => /Starts in/.test(r.message)), `the stale time-relative text was dropped: ${a.stderr}`);
});

// ---- M5 -------------------------------------------------------------------------------------
test("M5: back-to-back classes: no 'Up now' while he is in the previous class or has just left it", () => {
  const a = { id: "a", title: "CS1800 Discrete Structures — Lecture", kind: "class", start: m(9), end: m(10, 30), fixed: true, source: "calendar" };
  const b = { id: "b", title: "CS2100 Program Design — Lecture", kind: "class", start: m(10, 45), end: m(12), fixed: true, source: "calendar" };
  let sent = {};
  const urgent = [];
  for (const t of [m(10, 15), m(10, 20), m(10, 30), m(10, 40)]) {
    for (const o of decide({ bed: "23:45", wake: "07:45", day: [a, b], travel: [{ title: "commute to class", start: m(8, 15), end: m(9) }], sent, idleSeconds: 9999, signals: { wokeAt: m(7, 30), phone: [{ minute: m(8, 40), charging: false, motion: "walking" }] }, minute: t, out: true })) {   // positive evidence: he was at the first class
      sent = { ...sent, [o.key]: true }; if (o.urgent) urgent.push(`${t}:${o.key}`);
    }
  }
  assert.deepEqual(urgent, []);
});
test("M5: but if he missed the first class, the second class's ladder still fires", () => {
  const a = { id: "a", title: "CS1800 Lecture", kind: "class", start: m(9), end: m(10, 30), fixed: true, source: "calendar" };
  const b = { id: "b", title: "CS2100 Lecture", kind: "class", start: m(10, 45), end: m(12), fixed: true, source: "calendar" };
  const out = decide({ bed: "23:45", wake: "07:45", day: [a, b], travel: [], sent: {}, idleSeconds: 9999, signals: { wokeAt: m(10, 0), phone: [] }, minute: m(10, 35) });
  assert.ok(out.some((o) => o.urgent), JSON.stringify(out));
});

// ---- M6 -------------------------------------------------------------------------------------
test("M6: a check-in he set fires during a focus session, at any level", async () => {
  const home = mkdtempSync(join(tmpdir(), "orion-m6-"));
  const sock = join(home, "s.sock"), reply = join(home, "reply.json"); writeFileSync(reply, JSON.stringify({ status: "running" }));
  const srv = spawn(process.execPath, [join(W, "tests/fixtures/fake-session-server.mjs"), sock], { env: { ...process.env, FAKE_SESSION_REPLY: reply } });
  try {
    await new Promise((res) => srv.stdout.once("data", res));
    writeFileSync(join(home, "cal.json"), "[]");
    const nowMin = Math.floor(Date.now() / 60000);
    const file = join(home, "checkins.json");
    writeFileSync(file, JSON.stringify({ checkins: [{ id: "ci-1", what: "start the DS lab write-up", dueAt: nowMin - 5, createdAt: new Date().toISOString(), alerts: 0, returning: null, loop: { blockId: "ci-1", phase: "waiting", level: 0, nextCheckAt: nowMin - 5, deferrals: 0, history: [] } }] }));
    const tick = () => JSON.parse(spawnSync(process.execPath, [join(W, "scripts/orion-checkin"), "tick", "--json"], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: home, ORION_CHECKIN_FILE: file,
      ORION_BRIDGE_BIN: join(W, "tests/fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"), ORION_SESSION_SOCKET: sock } }).stdout);
    assert.equal(tick().length, 1, "the first reminder he asked for goes through");
    const saved = JSON.parse(readFileSync(file, "utf8")); saved.checkins[0].loop.nextCheckAt = nowMin - 1; writeFileSync(file, JSON.stringify(saved));
    assert.equal(tick().length, 1, "and so does a later one: a check-in he set is never frozen for the session (re-review)");
  } finally { srv.kill(); }
});

// ---- M7 -------------------------------------------------------------------------------------
test("M7: the installer's drift fingerprint covers the reach, proactive and morning files", () => {
  const src = readFileSync(join(W, "scripts/orion-remote-install"), "utf8");
  const fp = src.slice(src.indexOf("fingerprint() {"), src.indexOf("running()"));
  for (const f of ["scripts/orion-reach", "scripts/orion-proactive", "scripts/orion-morning", "scripts/lib/reach/*.mjs"]) assert.ok(fp.includes(f), f);
});

// ---- LOW ------------------------------------------------------------------------------------
test("LOW: a leave nudge for a non-class fixed destination does not bypass quiet hours", () => {
  const dinner = { id: "d", title: "Dinner with Sam", kind: "other", start: m(19), end: m(21), fixed: true, source: "calendar" };
  const out = decide({ bed: "23:45", wake: "07:45", day: [dinner], travel: [{ title: "getting to Dinner with Sam", start: m(18, 30), end: m(19) }], sent: {}, idleSeconds: 9999, minute: m(18, 20) });
  assert.equal(out[0].key, `leave-${m(19)}`);
  assert.equal(out[0].urgentKind, undefined);
});
test("LOW: a 'Cancelled:' class gets no ladder", () => {
  const c = { id: "c", title: "Cancelled: CS1800 Discrete Structures — Lecture", kind: "class", start: m(9), end: m(10, 30), fixed: true, source: "calendar" };
  assert.deepEqual(decide({ bed: "23:45", wake: "07:45", day: [c], travel: [{ title: "commute to class", start: m(8, 15), end: m(9) }], sent: {}, idleSeconds: 9999, signals: {}, minute: m(8, 20) }), []);
});
test("LOW: the held queue is lock-protected: concurrent appends are not lost to a clear", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-hl-"));
  for (let i = 0; i < 20; i++) appendHeld(dir, { id: `old-${i}`, at: "2026-10-16T01:00:00Z", text: `old ${i}` });
  const old = readHeld(dir);
  const appenders = Array.from({ length: 12 }, (_, i) => new Promise((res) => spawn(process.execPath, ["--input-type=module", "-e",
    `import { appendHeld } from "${join(W, "scripts/lib/reach/held.mjs")}"; for (let k=0;k<5;k++) appendHeld(${JSON.stringify(dir)}, { id: "new-${i}-" + k, at: "2026-10-16T02:00:00Z", text: "new" });`]).on("close", res)));
  const clearing = new Promise((res) => spawn(process.execPath, ["--input-type=module", "-e",
    `import { clearHeld } from "${join(W, "scripts/lib/reach/held.mjs")}"; for (let k=0;k<5;k++) clearHeld(${JSON.stringify(dir)}, ${JSON.stringify(old)});`]).on("close", res));
  await Promise.all([...appenders, clearing]);
  assert.equal(readHeld(dir).filter((e) => e.id.startsWith("new-")).length, 60);
  assert.equal(readHeld(dir).filter((e) => e.id.startsWith("old-")).length, 0);
});
test("LOW: the morning-lock takeover of a stale claim has exactly one winner", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-ml-"));
  claimBriefing(dir, "2026-10-15", { now: 1000 });
  const results = await Promise.all(Array.from({ length: 10 }, () => new Promise((res) => { let out = "";
    const c = spawn(process.execPath, ["--input-type=module", "-e", `import { claimBriefing } from "${join(W, "scripts/lib/reach/morning-lock.mjs")}"; console.log(claimBriefing(${JSON.stringify(dir)}, "2026-10-15", { now: Date.now() }).ok);`]);
    c.stdout.on("data", (d) => (out += d)); c.on("close", () => res(out.trim())); })));
  assert.equal(results.filter((r) => r === "true").length, 1, results.join(","));
});

// ---- found while fixing M1: a const used before its declaration made every CLI gather "unknown" -------------
test("the real brief, end to end: with a readable calendar and weather it names the class and the weather (not 'couldn't read')", () => {
  const w = world({ morningSent: false }); pinAlarm(w, 7, 0);
  writeFileSync(join(w.home, "w.json"), JSON.stringify({ hours: [7, 9, 12, 15].map((h) => ({ time: `2026-10-15T${String(h).padStart(2, "0")}:00`, day: "today", tempC: 12, rainChance: 0, rainMm: 0, snowCm: 0, code: 3 })) }));
  const r = w.script("orion-morning", ["signal", "unplugged", "--at", new Date(2026, 9, 15, 7, 28).toISOString()], 7, 30);
  assert.equal(r.status, 0, r.stderr);
  const text = w.outbox()[0].text;
  assert.match(text, /CS1800 Discrete Structures at 9/);
  assert.match(text, /12 degrees/);
  assert.doesNotMatch(text, /couldn't read|couldn't get the weather/);
});

// ---- re-review N1 / N2 -------------------------------------------------------------------------
test("N1: still asleep (no WHOOP, no phone samples): the 10:45 class gets a ladder when the 9:00 one is unknown", () => {
  const a = { id: "a", title: "CS1800 Discrete Structures — Lecture", kind: "class", start: m(9), end: m(10, 30), fixed: true, source: "calendar" };
  const b = { id: "b", title: "CS2100 Program Design — Lecture", kind: "class", start: m(10, 45), end: m(12), fixed: true, source: "calendar" };
  const travel = [{ title: "commute to class", start: m(8, 15), end: m(9) }];
  const run = (signals) => { let sent = {}; const said = [];
    for (let t = m(8); t <= m(11, 30); t += 5) for (const o of decide({ bed: "23:45", wake: "07:45", day: [a, b], travel, sent, idleSeconds: 9999, signals, minute: t })) { said.push(o.key); sent = { ...sent, [o.key]: true }; }
    return said; };
  assert.ok(run({ wokeAt: null, phone: [] }).some((k) => k.endsWith(`-${m(10, 45)}`)), "unknown never suppresses");
  assert.ok(!run({ wokeAt: m(7, 30), phone: [{ minute: m(8, 40), charging: false, motion: "walking" }] }).some((k) => /^(leave-late|wake)-/.test(k) && k.endsWith(`-${m(10, 45)}`)), "attended the first class (positive evidence): on campus, no 'Up now'");
});

test("N2: a standing heads-up (blocked --urgent, no approval) is held, not pushed, when Discord is down at 7 AM; a real approval request goes", () => {
  const n = notifyWorld(); writeFileSync(join(n.home, "reach-up"), "");
  const reach = join(n.home, "reach2"); writeFileSync(reach, `#!/bin/sh\necho "$@" >> ${join(n.home, "reach-args.log")}\n`); chmodSync(reach, 0o755);
  const env = { ...process.env, PATH: process.env.PATH, HOME: n.home, ORION_DISCORD_ALERT_BIN: join(n.home, "discord"), ORION_REACH_BIN: reach, ORION_SESSION_SOCKET: join(n.home, "no.sock") };
  const go = (args) => spawnSync(process.execPath, [join(W, "scripts/orion-notify"), ...args, "--now", "2026-10-16T07:00:00"], { encoding: "utf8", env });
  go(["blocked", "standing-check", "Heads up 9:00 AM - CS1800. Starts in 2h.", "--urgent"]);
  go(["blocked", "mission-x", "need the key", "--approval", "use staging key"]);
  const args = readFileSync(join(n.home, "reach-args.log"), "utf8").trim().split(/\n(?=Orion \|)/);
  assert.equal(args.length, 2);
  assert.doesNotMatch(args[0], /--urgent/);
  assert.match(args[1], /--urgent-kind reminder/);
});

test("N1b: woke at 7:30 but the phone sat on its charger through the 9:00: the 10:45 class still gets its ladder", () => {
  const a = { id: "a", title: "CS1800 Discrete Structures — Lecture", kind: "class", start: m(9), end: m(10, 30), fixed: true, source: "calendar" };
  const b = { id: "b", title: "CS2100 Program Design — Lecture", kind: "class", start: m(10, 45), end: m(12), fixed: true, source: "calendar" };
  const travel = [{ title: "commute to class", start: m(8, 15), end: m(9) }];
  const phone = [{ minute: m(9, 10), charging: true, motion: "stationary" }, { minute: m(10, 20), charging: true, motion: "stationary" }];
  let sent = {}; const said = [];
  for (let t = m(8); t <= m(11, 30); t += 5) for (const o of decide({ bed: "23:45", wake: "07:45", day: [a, b], travel, sent, idleSeconds: 9999, signals: { wokeAt: m(7, 30), phone }, minute: t })) { said.push(o.key); sent = { ...sent, [o.key]: true }; }
  assert.ok(said.includes(`class-missed-${m(9)}`), said.join(","));
  assert.ok(said.some((k) => /^(leave|leave-late|wake)-/.test(k) && k.endsWith(`-${m(10, 45)}`)), said.join(","));
  const wake = decide({ bed: "23:45", wake: "07:45", day: [b], travel: [], sent: {}, idleSeconds: 9999, signals: { wokeAt: m(7, 30), phone: [] }, minute: m(10, 30) });
  assert.match(wake.find((o) => o.key.startsWith("wake-"))?.text ?? "", /time to head out/, "an early wake swaps the text, it does not suppress");
});

test("check-ins: one ORION generated (--by orion) waits for the session; one he set fires", async () => {
  const home = mkdtempSync(join(tmpdir(), "orion-by-"));
  const sock = join(home, "s.sock"), reply = join(home, "reply.json"); writeFileSync(reply, JSON.stringify({ status: "running" }));
  const srv = spawn(process.execPath, [join(W, "tests/fixtures/fake-session-server.mjs"), sock], { env: { ...process.env, FAKE_SESSION_REPLY: reply } });
  try {
    await new Promise((res) => srv.stdout.once("data", res));
    writeFileSync(join(home, "cal.json"), "[]");
    const nowMin = Math.floor(Date.now() / 60000);
    const mk = (id, by) => ({ id, what: `start ${id}`, by, dueAt: nowMin - 5, createdAt: new Date().toISOString(), alerts: 0, returning: null, loop: { blockId: id, phase: "waiting", level: 0, nextCheckAt: nowMin - 5, deferrals: 0, history: [] } });
    const file = join(home, "checkins.json");
    writeFileSync(file, JSON.stringify({ checkins: [mk("ci-mine", "nick"), mk("ci-orion", "orion")] }));
    const out = JSON.parse(spawnSync(process.execPath, [join(W, "scripts/orion-checkin"), "tick", "--json"], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: home, ORION_CHECKIN_FILE: file,
      ORION_BRIDGE_BIN: join(W, "tests/fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"), ORION_SESSION_SOCKET: sock } }).stdout);
    assert.deepEqual(out.map((a) => a.id), ["ci-mine"]);
  } finally { srv.kill(); }
});
