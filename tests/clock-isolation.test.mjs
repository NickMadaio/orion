// ORION_NOW and ORION_CONTROLLED_DIR (2026-10-30): one clock for every time-driven script, and a state copy that can
// never reach Nick. Everything here runs in a temp HOME; no /Users paths (CI is Linux).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { clockNow, isolated, outboxed, toOutbox, controlledDir, OUTBOX_FILE } from "../scripts/lib/clock.mjs";

const SCRIPTS = join(import.meta.dirname, "../scripts");
const readRows = (dir) => (existsSync(join(dir, OUTBOX_FILE)) ? readFileSync(join(dir, OUTBOX_FILE), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

test("clockNow: ORION_NOW is the clock; a named legacy seam wins; junk is ignored", () => {
  assert.equal(clockNow({ ORION_NOW: "2026-10-30T12:40:00Z" }).toISOString(), "2026-10-30T12:40:00.000Z");
  assert.equal(clockNow({ ORION_NOW: "2026-10-30T12:40:00Z", ORION_REACH_NOW: "2026-10-30T09:00:00Z" }, ["ORION_REACH_NOW"]).toISOString(), "2026-10-30T09:00:00.000Z");
  assert.equal(clockNow({ ORION_NOW: "2026-10-30T12:40:00Z", ORION_REACH_NOW: "2026-10-30T09:00:00Z" }).toISOString(), "2026-10-30T12:40:00.000Z", "a seam not named is not read");
  const before = Date.now();
  assert.ok(clockNow({ ORION_NOW: "not a time" }).getTime() >= before);
});

test("isolated: only a directory other than the live one isolates", () => {
  const home = mkdtempSync(join(tmpdir(), "orion-clock-"));
  const live = join(home, ".openclaw/orion-controlled");
  const env = (extra) => ({ HOME: home, ...extra });
  // homedir() reads HOME on POSIX, but only at call time in this process: check through a child
  const probe = (extra) => JSON.parse(spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { isolated, controlledDir } from ${JSON.stringify(join(SCRIPTS, "lib/clock.mjs"))}; console.log(JSON.stringify({ iso: isolated(), dir: controlledDir() }))`],
  { encoding: "utf8", env: { PATH: process.env.PATH, ...env(extra) } }).stdout);
  assert.deepEqual(probe({}), { iso: false, dir: live });
  assert.equal(probe({ ORION_CONTROLLED_DIR: live }).iso, false, "the live dir named explicitly (orion-remote does this) is not a test");
  assert.equal(probe({ ORION_CONTROLLED_DIR: join(home, "copy") }).iso, true);
  assert.equal(isolated({}), false);
  assert.equal(controlledDir({ ORION_CONTROLLED_DIR: "/x" }), "/x");
});

test("outboxed: a named test seam still runs; the real binary does not", () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-clock-"));
  assert.equal(outboxed({ ORION_CONTROLLED_DIR: dir }, "ORION_REACH_OPEN_BIN"), true);
  assert.equal(outboxed({ ORION_CONTROLLED_DIR: dir, ORION_REACH_OPEN_BIN: "/bin/true" }, "ORION_REACH_OPEN_BIN"), false);
  const row = toOutbox("phone", { text: "hi" }, { env: { ORION_CONTROLLED_DIR: dir, ORION_NOW: "2026-10-30T12:40:00Z" }, by: "test" });
  assert.equal(row.at, "2026-10-30T12:40:00.000Z");
  assert.deepEqual(readRows(dir).map((r) => [r.channel, r.by, r.payload.text]), [["phone", "test", "hi"]]);
});

// ---- end to end: a state copy, no seams at all, nothing goes out ----------------
function copyWorld() {
  const home = mkdtempSync(join(tmpdir(), "orion-iso-"));
  const dir = join(home, "state-copy");       // NOT $HOME/.openclaw/orion-controlled: isolated
  mkdirSync(dir, { recursive: true });
  const now = new Date(2026, 9, 30, 12, 40);
  const at = now.toISOString();
  writeFileSync(join(dir, "awareness.json"), JSON.stringify({ schema: "orion.awareness.v1", at,
    session: { state: "none", at, source: "socket" }, calendar: { state: "ok", now: null, next: null, at },
    location: { state: "unknown", at: null }, mac: { state: "active", idleSeconds: 5, at },
    audio: { mac: { route: "speakers", headphones: false, at }, phone: { route: "unknown", at: null } },
    sleep: { state: "awake", inWindow: false, at } }));
  writeFileSync(join(dir, "life-config.json"), JSON.stringify({ bedtime: "23:59", usualWake: "00:01" }));
  // a tripwire `open`: if isolation leaked, this file would appear
  const env = { PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_NOW: at, ORION_AWARENESS_NO_REFRESH: "1",
    ORION_SESSION_SOCKET: join(home, "no.sock"), ORION_REACH_FACTS: JSON.stringify({ idleSeconds: 5, locked: false, headphones: false }) };
  return { home, dir, env, now };
}

test("orion-reach in a state copy: the Mac app and the phone are never touched, the outbox has the message", () => {
  const w = copyWorld();
  const r = spawnSync(process.execPath, [join(SCRIPTS, "orion-reach"), "Time to start: Gym.", "--kind", "checkin", "--why", "test: isolation"], { encoding: "utf8", env: w.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rows = readRows(w.dir);
  assert.ok(rows.some((x) => x.channel === "mac-app" && /orion:\/\/reach/.test(x.payload.url)), JSON.stringify(rows));
  // the phone link reads outreach-outbox.jsonl from the LIVE dir only; in the copy it is inert, and nothing was written outside it
  assert.equal(existsSync(join(w.home, ".openclaw")), false, "nothing written under the real state dir");
});

test("orion-notify in a state copy: Discord and OpenClaw are never called", () => {
  const w = copyWorld();
  const r = spawnSync(process.execPath, [join(SCRIPTS, "orion-notify"), "milestone", "iso-test", "Half way.", "--urgent"], { encoding: "utf8", env: w.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rows = readRows(w.dir);
  assert.ok(rows.some((x) => x.channel === "discord" && /Half way/.test(x.payload.text)), JSON.stringify(rows) + r.stderr);
  assert.ok(existsSync(join(w.dir, "remote.json")), "its state lives in the copy");
  assert.equal(existsSync(join(w.home, ".openclaw")), false);
});

test("bridge writes in a state copy go to the outbox; reads still run (through the given fake bridge)", async () => {
  const w = copyWorld();
  const cal = join(w.home, "cal.json");
  writeFileSync(cal, "[]");
  const code = `import { bridgeRequest } from ${JSON.stringify(join(SCRIPTS, "lib/life/bridge-path.mjs"))};
    const read = await bridgeRequest("list_upcoming_calendar_events", { from: "today" });
    let wrote; try { await bridgeRequest("create_calendar_event", { title: "x" }); wrote = "sent"; } catch (e) { wrote = e.message; }
    console.log(JSON.stringify({ read, wrote }));`;
  // the real bridge is replaced only for writes: reads need a bridge, so the fake one answers reads here via ORION_BRIDGE_READ_BIN
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8",
    env: { ...w.env, ORION_BRIDGE_READ_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: cal } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split("\n").at(-1));
  assert.equal(out.read.events_json, "[]");
  assert.match(out.wrote, /isolated/);
  assert.deepEqual(readRows(w.dir).map((x) => [x.channel, x.payload.action]), [["calendar", "create_calendar_event"]]);
  assert.equal(readFileSync(cal, "utf8"), "[]", "the calendar was not written");
});

test("orion-proactive tick in a state copy: writes now.json, sends nothing, every outward step is in the outbox", () => {
  const w = copyWorld();
  const cal = join(w.home, "cal.json");
  const d = w.now; const iso = (h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString();
  writeFileSync(cal, JSON.stringify([{ identifier: "gym1", title: "Gym", start: iso(12, 0), end: iso(13, 30), orion: "gym" }]));
  const env = { ...w.env, ORION_BRIDGE_READ_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: cal };
  const r = spawnSync(process.execPath, [join(SCRIPTS, "orion-proactive"), "tick"], { encoding: "utf8", env, timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const now = JSON.parse(readFileSync(join(w.dir, "now.json"), "utf8"));
  assert.equal(now.schemaVersion, 1);
  assert.equal(now.computedAt, w.now.toISOString());
  assert.equal(now.shouldBe.title, "Gym");
  assert.equal(now.mismatch?.kind, "not-started");
  assert.equal(readFileSync(cal, "utf8").includes("Gym"), true);
  assert.equal(existsSync(join(w.home, ".openclaw")), false, "nothing under the real state dir");
  for (const row of readRows(w.dir)) assert.ok(["mac-app", "phone", "discord", "openclaw", "calendar", "reminders", "lights", "voice"].includes(row.channel), row.channel);
});

test("orion-checkin at ORION_NOW in a state copy: the loop counts from the fake clock and its nudge lands in the outbox", () => {
  const w = copyWorld();
  const cal = join(w.home, "cal.json");
  writeFileSync(cal, "[]");
  const env = { ...w.env, ORION_BRIDGE_READ_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: cal };
  const run = (args, now) => spawnSync(process.execPath, [join(SCRIPTS, "orion-checkin"), ...args], { encoding: "utf8", env: { ...env, ORION_NOW: now } });
  const add = run(["add", "0", "Gym", "--by", "orion", "--block", "gym", "--day", "2026-10-30", "--start", String(12 * 60), "--end", String(13 * 60 + 30), "--tier", "protected"], w.now.toISOString());
  assert.equal(add.status, 0, add.stdout + add.stderr);
  const saved = JSON.parse(readFileSync(join(w.dir, "checkins.json"), "utf8")).checkins;
  assert.equal(saved.length, 1, "the check-in lives in the copy");
  const tick = run(["tick", "--json"], new Date(w.now.getTime() + 60_000).toISOString());
  assert.equal(tick.status, 0, tick.stderr);
  const rows = readRows(w.dir);
  assert.ok(rows.length >= 1 && rows.every((r) => ["mac-app", "phone"].includes(r.channel)), JSON.stringify(rows) + tick.stdout);
  assert.ok(rows.some((r) => /Gym/.test(r.payload.text ?? "")), JSON.stringify(rows));
  assert.equal(existsSync(join(w.home, ".openclaw")), false);
});

test("orion-watch at ORION_NOW in a state copy: reads the copy, writes the copy, no calendar or reminder write leaves it", () => {
  const w = copyWorld();
  const cal = join(w.home, "cal.json");
  writeFileSync(cal, "[]");
  writeFileSync(join(w.dir, "health-log.json"), JSON.stringify({ days: { "2026-10-30": { sleepHours: 3.7 } }, sleepLog: [{ event: "up", at: new Date(2026, 9, 30, 9, 0).toISOString() }] }));
  const env = { ...w.env, ORION_NOW: new Date(2026, 9, 30, 9, 30).toISOString(), ORION_BRIDGE_READ_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: cal };
  const r = spawnSync(process.execPath, [join(SCRIPTS, "orion-watch"), "tick", "--json"], { encoding: "utf8", env, timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const watch = JSON.parse(readFileSync(join(w.dir, "watch.json"), "utf8"));
  assert.ok(watch["2026-10-30"], "the fake clock's day, in the copy's watch.json");
  assert.equal(readFileSync(cal, "utf8"), "[]");
  assert.equal(existsSync(join(w.home, ".openclaw")), false);
  for (const row of readRows(w.dir)) assert.ok(["phone", "calendar", "reminders", "mac-app"].includes(row.channel), row.channel);
});
