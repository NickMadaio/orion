import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decide } from "../scripts/lib/life/sleep-nudge.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-sleep-nudge");
const D = (day, h, m = 0) => new Date(2026, 10, day, h, m, 0, 0);
const wake = D(4, 6);
const plan = (over = {}) => ({
  source: "nick", sleepHours: 8, nudgeBeforeMin: 30, lockdownBelowHours: 6,
  alarms: [{ date: "2026-11-04", at: "06:00", iso: wake.toISOString(), reason: "plan" }],
  bedtimes: [{ date: "2026-11-03", sleepBy: "22:00", nudgeAt: "21:30", sleepByIso: D(3, 22).toISOString(), nudgeAtIso: D(3, 21, 30).toISOString() }],
  lockdowns: [{ date: "2026-11-03", at: "00:00", iso: D(4, 0).toISOString(), exception: null }],
  ...over,
});
const told = (reason = "schoolwork") => plan({ lockdowns: [{ date: "2026-11-03", at: "00:00", iso: D(4, 0).toISOString(), exception: { reason, until: null } }] });
const up = { mac: { idleSeconds: 30, locked: false, app: "Safari", bundleID: "com.apple.Safari" }, phone: { usedMinutesAgo: null }, calendar: [] };
const types = (r) => r.actions.map((a) => (a.type === "message" ? `message:${a.step}` : a.type));

// Walks the ticks the way the CLI does: feeds state back in.
function walk(p, times, signals = up) {
  let state = null;
  const log = [];
  for (const t of times) { const r = decide(t, p, signals, state); state = r.state; log.push({ t, r }); }
  return log;
}

test("ladder order: nudge, bedtime, firm, warn, dim, lockdown, one rung per tick", () => {
  const log = walk(plan(), [D(3, 21, 29), D(3, 21, 30), D(3, 22, 0), D(3, 22, 15), D(3, 23, 1), D(3, 23, 10), D(3, 23, 17), D(4, 0, 5)]);
  assert.deepEqual(log.map((l) => types(l.r)), [
    [], ["message:nudge"], ["message:bedtime"], ["message:firm"], ["message:warn"], [],
    ["dim", "quit-app", "quit-app", "quit-app", "quit-app", "quit-app", "phone-block"],
    ["phone-block", "lock-screen", "message:lockdown"]]);
  const lock = log.at(-1).r.actions[0];
  assert.deepEqual(lock.groups, ["social", "video", "games", "browsers"]);
  assert.equal(lock.minutes, 355);
  assert.match(log[1].r.actions[0].text, /6:00 AM/);
  assert.match(log.at(-1).r.actions.at(-1).text, /schoolwork or you're out/);
});

test("every rung is once only", () => {
  const sent = walk(plan(), [D(3, 21, 30), D(3, 21, 35), D(3, 21, 40), D(3, 22, 0), D(3, 22, 5)]).flatMap((l) => types(l.r));
  assert.deepEqual(sent, ["message:nudge", "message:bedtime"]);
});

test("a late first tick sends only the latest message, not a pile", () => {
  const log = walk(plan(), [D(3, 22, 20), D(3, 22, 25)]);
  assert.deepEqual(log.map((l) => types(l.r)), [["message:firm"], []]);
});

test("a Nick who is not active gets nothing, even at lockdown time", () => {
  const idle = { mac: { idleSeconds: 1500, locked: false }, phone: { usedMinutesAgo: 240 }, calendar: [] };
  const log = walk(plan(), [D(3, 21, 30), D(3, 22, 0), D(3, 23, 30), D(4, 1, 0)], idle);
  assert.ok(log.every((l) => l.r.actions.length === 0));
  const locked = { mac: { idleSeconds: 5, locked: true }, phone: {}, calendar: [] };
  assert.equal(decide(D(3, 22, 0), plan(), locked, null).actions.length, 0);
});

test("phone use in the last 10 minutes counts as active", () => {
  const r = decide(D(3, 22, 0), plan(), { mac: {}, phone: { usedMinutesAgo: 3 }, calendar: [] }, null);
  assert.equal(r.actions[0].step, "bedtime");
});

test("a default plan, or no plan, does nothing", () => {
  assert.equal(decide(D(4, 1, 0), plan({ source: "default" }), up, null).actions.length, 0);
  assert.equal(decide(D(4, 1, 0), null, up, null).actions.length, 0);
});

test("the evaluation sandbox does nothing unless a test drives it", () => {
  assert.equal(decide(D(3, 22, 0), plan(), { ...up, sandbox: true }, null).actions.length, 0);
  assert.equal(decide(D(3, 22, 0), plan(), { ...up, sandbox: true, drivenByTest: true }, null).actions.length, 1);
});

test("an exception he told ORION: no lockdown, no dim, one gentle message", () => {
  const log = walk(told(), [D(3, 21, 30), D(3, 22, 15), D(3, 23, 30), D(4, 0, 5), D(4, 0, 30), D(4, 2, 0)]);
  assert.deepEqual(log.flatMap((l) => types(l.r)), ["message:gentle"]);
});

test("a friends event tonight is legit; a schoolwork block running now is legit", () => {
  const out = [{ title: "Drinks with friends", start: D(3, 20).toISOString(), end: D(4, 1).toISOString() }];
  assert.deepEqual(walk(plan(), [D(3, 23, 30), D(4, 0, 30)], { ...up, calendar: out }).flatMap((l) => types(l.r)), ["message:gentle"]);
  const work = [{ title: "CS3000 problem set", start: D(3, 22).toISOString(), end: D(4, 2).toISOString() }];
  assert.ok(!walk(plan(), [D(3, 23, 30), D(4, 0, 30)], { ...up, calendar: work }).flatMap((l) => types(l.r)).includes("lock-screen"));
});

test("gaming is not a legit reason: the guessed exception is voided and he is locked down", () => {
  const gaming = { ...up, mac: { idleSeconds: 5, app: "Minecraft", bundleID: "com.mojang.minecraft" },
    calendar: [{ title: "Dinner with friends", start: D(3, 18).toISOString(), end: D(4, 0, 30).toISOString() }] };
  assert.ok(walk(plan(), [D(3, 23, 1), D(3, 23, 17), D(4, 0, 5)], gaming).flatMap((l) => types(l.r)).includes("lock-screen"));
  // idling with no calendar is no reason either
  assert.ok(walk(plan(), [D(3, 23, 1), D(3, 23, 17), D(4, 0, 5)]).flatMap((l) => types(l.r)).includes("lock-screen"));
});

test("talking ORION out of it lifts the lockdown, and wake undoes what is held", () => {
  const held = walk(plan(), [D(3, 23, 1), D(3, 23, 17), D(4, 0, 5)]).at(-1).r.state;
  const lifted = decide(D(4, 0, 10), told("friends"), up, held);
  assert.deepEqual(types(lifted), ["undim", "phone-unblock", "phone-unblock", "phone-unblock", "phone-unblock"]);
  assert.deepEqual(types(decide(D(4, 0, 15), told("friends"), up, lifted.state)), ["message:gentle"]);
  // wake: needs no activity
  const woke = decide(D(4, 6, 1), plan(), { mac: {}, phone: {}, calendar: [] }, held);
  assert.deepEqual(woke.actions.map((a) => a.group ?? a.type).sort(), ["browsers", "games", "social", "undim", "video"]);
  assert.equal(woke.state.held.dimmed, false);
  assert.equal(decide(D(4, 6, 5), plan(), up, woke.state).actions.length, 0);
});

// ---- CLI with mock bins ----
function setup(planDoc, { refresh = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sleep-nudge-"));
  const calls = join(dir, "calls.jsonl");
  const mk = (name) => {
    const f = join(dir, name);
    writeFileSync(f, `#!/usr/bin/env node\nrequire("fs").appendFileSync(${JSON.stringify(calls)}, JSON.stringify({bin:${JSON.stringify(name)},args:process.argv.slice(2)})+"\\n");\n`);
    chmodSync(f, 0o755);
    return f;
  };
  writeFileSync(join(dir, "wake-plan.json"), JSON.stringify(planDoc));
  writeFileSync(join(dir, "signals.json"), JSON.stringify(up));
  const env = { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_REACH_BIN: mk("reach"), ORION_BEDTIME_ACT_BIN: mk("act"), ORION_PHONE_TIME_BIN: mk("phone"), ...(refresh ? { ORION_SLEEPPLAN_BIN: mk("sleepplan") } : {}) };
  delete env.ORION_NOW;
  delete env.ORION_RESCHEDULE_NOW;
  const tick = (iso, ...extra) => spawnSync(process.execPath, [script, "tick", "--json", "--now", iso, "--signals", join(dir, "signals.json"), ...extra], { env, encoding: "utf8" });
  const called = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { dir, tick, called };
}

test("CLI: runs the ladder through the injected bins, persists state, logs", () => {
  const { dir, tick, called } = setup(plan());
  const first = JSON.parse(tick(D(3, 21, 30).toISOString()).stdout);
  assert.equal(first.ok, true);
  assert.equal(called().length, 1);
  assert.equal(called()[0].bin, "reach");
  assert.ok(called()[0].args.includes("--awake"));
  assert.equal(JSON.parse(tick(D(3, 21, 35).toISOString()).stdout).actions.length, 0, "once only across processes");
  tick(D(3, 23, 1).toISOString());
  tick(D(3, 23, 17).toISOString());
  tick(D(4, 0, 5).toISOString());
  const bins = called().map((c) => `${c.bin}:${c.args[0]}`);
  assert.ok(bins.includes("act:dim") && bins.includes("act:lock-screen"));
  assert.equal(called().filter((c) => c.bin === "phone" && c.args[1] === "social,video,games,browsers").length, 1);
  assert.ok(readFileSync(join(dir, "sleep-nudge-log.jsonl"), "utf8").split("\n").length > 3);
  tick(D(4, 6, 1).toISOString());
  assert.ok(called().some((c) => c.bin === "act" && c.args[0] === "undim"));
  assert.ok(called().some((c) => c.bin === "phone" && c.args.join(" ") === "unblock browsers"));
});

test("CLI: --dry-run changes and runs nothing; a default plan does nothing", () => {
  const a = setup(plan());
  const r = JSON.parse(a.tick(D(3, 22, 0).toISOString(), "--dry-run").stdout);
  assert.equal(r.actions.length, 1);
  assert.equal(a.called().length, 0);
  assert.equal(existsSync(join(a.dir, "sleep-nudge-state.json")), false);
  const b = setup(plan({ source: "default" }));
  b.tick(D(4, 1, 0).toISOString());
  assert.equal(b.called().length, 0);
});

test("CLI: a missing plan file is fine and exits 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "sleep-nudge-"));
  const r = spawnSync(process.execPath, [script, "tick", "--json", "--now", D(3, 22).toISOString()], { env: { ...process.env, ORION_CONTROLLED_DIR: dir }, encoding: "utf8" });
  assert.equal(r.status, 0);
});

test("CLI: a stale plan is refreshed through the sleep-plan writer, a fresh one is not", () => {
  const a = setup({ ...plan(), generatedAt: D(1, 9).toISOString() }, { refresh: true });
  a.tick(D(3, 20).toISOString());
  assert.deepEqual(a.called().filter((c) => c.bin === "sleepplan").map((c) => c.args), [["refresh", "--json"]]);
  const b = setup({ ...plan(), generatedAt: D(3, 9).toISOString() }, { refresh: true });
  b.tick(D(3, 20).toISOString());
  assert.equal(b.called().filter((c) => c.bin === "sleepplan").length, 0);
});
