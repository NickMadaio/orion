// w18 bedtime (2026-11-04): "yes" to ORION's shut-it-down offer really shuts the Mac down (quit-unused with full escalation, then lock),
// the Mac stays shut during the window (nudge once, lock again, a time-limited pass, a manual override), and the room's light is a
// bedtime signal. Everything here uses stub executables and a temp state dir: nothing quits an app or locks a screen.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { guardStep, grantPass, passActive, armNight, setOverride, emptyState, macInUse, PASS_MAX_MIN, PASS_NIGHT_MAX_MIN } from "../scripts/lib/life/bedtime-shutdown.mjs";
import { tonightWindow } from "../scripts/lib/life/bedtime-window.mjs";
import { lockMac } from "../scripts/lib/life/lock-mac.mjs";
import { classifyLight } from "../scripts/lib/light/classify.mjs";
import { readiness } from "../scripts/lib/life/readiness.mjs";
import { decide } from "../scripts/lib/life/sleep-nudge.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const D = (day, h, m = 0, s = 0) => new Date(2026, 10, day, h, m, s, 0);
const win = { start: D(3, 21, 30), end: D(4, 6) };
const using = { idleSeconds: 4, locked: false, displayAsleep: false };
const away = { idleSeconds: 4, locked: true, displayAsleep: false };

// ---- the guard ----
test("macInUse: unlocked, display on, touched in the last 3 minutes", () => {
  assert.equal(macInUse(using), true);
  assert.equal(macInUse(away), false);
  assert.equal(macInUse({ idleSeconds: 4, locked: false, displayAsleep: true }), false);
  assert.equal(macInUse({ idleSeconds: 900, locked: false, displayAsleep: false }), false);
  assert.equal(macInUse({}), false);
});

test("guard: not armed means no nudge and no lock", () => {
  const r = guardStep({ now: D(3, 23, 50), window: win, state: emptyState(), mac: using });
  assert.equal(r.action, "none");
});

test("guard: armed, Mac wakes and is used: one quiet nudge, then a lock two minutes later", () => {
  let st = armNight(emptyState(), win, D(3, 23, 40));
  const a = guardStep({ now: D(3, 23, 50), window: win, state: st, mac: using });
  assert.equal(a.action, "nudge");
  st = a.state;
  assert.equal(guardStep({ now: D(3, 23, 50, 40), window: win, state: st, mac: using }).action, "none");   // once, not every tick
  assert.equal(guardStep({ now: D(3, 23, 51, 59), window: win, state: st, mac: using }).action, "none");
  const b = guardStep({ now: D(3, 23, 52, 1), window: win, state: st, mac: using });
  assert.equal(b.action, "lock");
  // locked again: the next wake gets its own single nudge
  assert.equal(guardStep({ now: D(3, 23, 59), window: win, state: b.state, mac: away }).action, "none");
  assert.equal(guardStep({ now: D(4, 0, 30), window: win, state: b.state, mac: using }).action, "nudge");
});

test("guard: he locks it himself before the two minutes are up, so nothing more happens", () => {
  const st = armNight(emptyState(), win, D(3, 23, 40));
  const a = guardStep({ now: D(3, 23, 50), window: win, state: st, mac: using });
  const b = guardStep({ now: D(3, 23, 51), window: win, state: a.state, mac: away });
  assert.equal(b.action, "none");
  assert.equal(guardStep({ now: D(3, 23, 56), window: win, state: b.state, mac: using }).action, "nudge");
});

test("guard: a pass holds it off until it runs out, then the usual nudge and lock", () => {
  let st = armNight(emptyState(), win, D(3, 23, 40));
  const g = grantPass(st, 20, D(3, 23, 50));
  assert.equal(g.minutes, 20);
  st = g.state;
  assert.equal(passActive(st, D(4, 0, 9)), true);
  assert.equal(passActive(st, D(4, 0, 11)), false);
  assert.equal(guardStep({ now: D(4, 0, 5), window: win, state: st, mac: using }).action, "none");
  const n = guardStep({ now: D(4, 0, 12), window: win, state: st, mac: using });
  assert.equal(n.action, "nudge");
  assert.equal(guardStep({ now: D(4, 0, 15), window: win, state: n.state, mac: using }).action, "lock");
});

test("a pass is capped, and a new pass replaces the old one rather than stacking", () => {
  const g = grantPass(armNight(emptyState(), win, D(3, 23, 40)), 180, D(3, 23, 50));
  assert.equal(g.minutes, PASS_MAX_MIN);
  assert.equal(g.capped, true);
  const h = grantPass(g.state, 10, D(3, 23, 55));
  assert.equal(new Date(h.state.passUntil).getTime(), D(4, 0, 5).getTime());
});

test("a pass that comes in while a nudge is pending cancels the lock", () => {
  let st = armNight(emptyState(), win, D(3, 23, 40));
  st = guardStep({ now: D(3, 23, 50), window: win, state: st, mac: using }).state;
  st = grantPass(st, 20, D(3, 23, 51)).state;
  assert.equal(guardStep({ now: D(3, 23, 53), window: win, state: st, mac: using }).action, "none");
});

test("guard: the manual override switches it off for the night, and resume switches it back on", () => {
  let st = setOverride(armNight(emptyState(), win, D(3, 23, 40)), true);
  assert.equal(guardStep({ now: D(3, 23, 50), window: win, state: st, mac: using }).action, "none");
  st = setOverride(st, false);
  assert.equal(guardStep({ now: D(3, 23, 50), window: win, state: st, mac: using }).action, "nudge");
});

test("guard: outside the window it does nothing, and a new night starts clean", () => {
  const st = armNight(emptyState(), win, D(3, 23, 40));
  assert.equal(guardStep({ now: D(4, 6, 1), window: win, state: st, mac: using }).action, "none");
  assert.equal(guardStep({ now: D(4, 1), window: { reason: "It is not bedtime yet." }, state: st, mac: using }).action, "none");
  const next = { start: D(4, 21, 30), end: D(5, 6) };
  const fresh = armNight(setOverride(st, true), next, D(4, 22));
  assert.equal(fresh.override, false);
});

// ---- the lock chain ----
test("lockMac tries the real lock first and falls through to the next method only when one fails", async () => {
  const seen = [];
  const exec = (ok) => async (cmd, args) => { seen.push(cmd); return { status: ok.includes(cmd) ? 0 : 1 }; };
  const r1 = await lockMac({ exec: exec(["bridge"]), verify: async () => true, bridge: "bridge", osascript: "osascript", pmset: "pmset" });
  assert.deepEqual([r1.ok, r1.method, seen], [true, "bridge", ["bridge"]]);
  seen.length = 0;
  const r2 = await lockMac({ exec: exec(["pmset"]), verify: async () => false, bridge: "bridge", osascript: "osascript", pmset: "pmset" });
  assert.deepEqual([r2.ok, r2.method, r2.locked, seen], [true, "display-sleep", false, ["bridge", "osascript", "pmset"]]);
  seen.length = 0;
  const r3 = await lockMac({ exec: exec([]), verify: async () => false, bridge: "bridge", osascript: "osascript", pmset: "pmset" });
  assert.equal(r3.ok, false);
  assert.equal(seen.length, 3);
});

// ---- light ----
test("classifyLight: ambient light sensor readings, lid state, and the display fallback", () => {
  assert.equal(classifyLight({ als: { lux: 220 }, lidClosed: false }).state, "bright");
  assert.equal(classifyLight({ als: { lux: 12 }, lidClosed: false }).state, "dim");
  assert.equal(classifyLight({ als: { lux: 1.5 }, lidClosed: false }).state, "dark");
  const closed = classifyLight({ als: { lux: 0 }, lidClosed: true });
  assert.equal(closed.state, "unknown");
  assert.match(closed.note, /lid/i);
  const proxy = classifyLight({ als: { lux: null }, display: { brightness: 0.8 }, lidClosed: false });
  assert.deepEqual([proxy.state, proxy.source], ["bright", "display"]);
  const none = classifyLight({ als: { lux: null }, display: { brightness: null }, lidClosed: false });
  assert.equal(none.state, "unknown");
  assert.match(none.note, /no light sensor/i);
  assert.equal(classifyLight(null).state, "unknown");
});

test("orion-light with a stub reads as the sensor says and never invents a value", () => {
  const stub = (json) => { const dir = mkdtempSync(join(tmpdir(), "light-")); const f = join(dir, "helper"); writeFileSync(f, `#!/bin/sh\necho '${json}'\n`); chmodSync(f, 0o755); return f; };
  const run = (bin) => JSON.parse(spawnSync("node", [join(root, "orion-light"), "read", "--json"], { env: { ...process.env, ORION_LIGHT_BIN: bin }, encoding: "utf8" }).stdout);
  assert.equal(run(stub('{"als":{"lux":340,"event":true},"display":{"brightness":0.7},"lidClosed":false}')).state, "bright");
  assert.equal(run(stub('{"als":{"lux":null},"display":{"brightness":null},"lidClosed":false}')).state, "unknown");
  assert.equal(run("/nonexistent/helper").state, "unknown");
});

// ---- readiness ----
test("readiness: lights on and on the Mac is not winding down; either one alone is softer; a dark room is winding down", () => {
  const mac = { idleSeconds: 5, locked: false };
  const r = readiness({ mac, phone: {}, light: { state: "bright", source: "als" } });
  assert.deepEqual([r.windingDown, r.notWinding], [false, true]);
  assert.match(r.say, /lights are still on and you're on the Mac/);
  const dim = readiness({ mac, phone: {}, light: { state: "dark", source: "als" } });
  assert.deepEqual([dim.windingDown, dim.notWinding], [false, false]);
  const nolight = readiness({ mac, phone: {}, light: { state: "unknown" } });
  assert.equal(nolight.notWinding, false);
  assert.equal(nolight.say, "");
  const lit = readiness({ mac: { idleSeconds: 2000, locked: false }, phone: {}, light: { state: "bright", source: "als" } });
  assert.equal(lit.notWinding, false);
  assert.equal(readiness({ mac: { idleSeconds: 2000 }, phone: { usedMinutesAgo: 2 }, light: { state: "bright", source: "als" } }).notWinding, false);
});

const plan = () => ({
  source: "nick", sleepHours: 8, nudgeBeforeMin: 30, lockdownBelowHours: 6,
  alarms: [{ date: "2026-11-04", at: "06:00", iso: D(4, 6).toISOString(), reason: "plan" }],
  bedtimes: [{ date: "2026-11-03", sleepBy: "22:00", nudgeAt: "21:30", sleepByIso: D(3, 22).toISOString(), nudgeAtIso: D(3, 21, 30).toISOString() }],
  lockdowns: [{ date: "2026-11-03", at: "00:00", iso: D(4, 0).toISOString(), exception: null }],
});
const upMac = { idleSeconds: 30, locked: false, app: "Terminal", bundleID: "com.apple.Terminal" };
const types = (r) => r.actions.map((a) => (a.type === "message" ? `message:${a.step}` : a.type));

test("sleep-nudge: lights on plus the Mac in use brings the firm rung forward and says why", () => {
  const sig = (light) => ({ mac: upMac, phone: {}, calendar: [], light });
  const t = D(3, 22, 6);
  let st = decide(D(3, 21, 30), plan(), sig({ state: "bright", source: "als" }), null).state;
  st = decide(D(3, 22, 0), plan(), sig({ state: "bright", source: "als" }), st).state;
  const lit = decide(t, plan(), sig({ state: "bright", source: "als" }), st);
  assert.deepEqual(types(lit), ["message:firm"]);
  assert.match(lit.actions[0].text, /lights are still on and you're on the Mac/);
  assert.match(lit.actions[0].text, /shut (?:it all|things) down/);
  // same minute, room unknown or dark: still the normal 15 minute wait
  for (const light of [{ state: "unknown" }, { state: "dark", source: "als" }, undefined]) {
    let s2 = decide(D(3, 21, 30), plan(), sig(light), null).state;
    s2 = decide(D(3, 22, 0), plan(), sig(light), s2).state;
    assert.deepEqual(types(decide(t, plan(), sig(light), s2)), []);
  }
});

test("sleep-nudge: ORION's own dimming is not read as a lit room", () => {
  const sig = { mac: upMac, phone: {}, calendar: [], light: { state: "bright", source: "display" } };
  let st = decide(D(3, 21, 30), plan(), sig, null).state;
  st = decide(D(3, 22, 0), plan(), sig, st).state;
  assert.deepEqual(types(decide(D(3, 22, 6), plan(), sig, st)), []);   // a display-brightness proxy never firms the timing
});

// ---- the shutdown command, end to end against stub bins ----
function rig({ appsJson, lockOk = true, lockOut = "",  plan: planDoc = plan() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "shutdown-"));
  const calls = join(dir, "calls.jsonl");
  const mk = (name, body) => { const f = join(dir, name); writeFileSync(f, `#!/usr/bin/env node\nrequire("fs").appendFileSync(${JSON.stringify(calls)}, JSON.stringify({bin:${JSON.stringify(name)},args:process.argv.slice(2)})+"\\n");\n${body}`); chmodSync(f, 0o755); return f; };
  writeFileSync(join(dir, "wake-plan.json"), JSON.stringify(planDoc));
  const apps = mk("apps", `console.log(${JSON.stringify(JSON.stringify(appsJson ?? { ok: true, closed: ["Safari", "Discord"], results: [{ name: "Safari", state: "closed" }, { name: "Discord", state: "closed" }], say: "Closed Safari and Discord." }))});`);
  const lock = mk("lock", `${lockOut ? `console.log(${JSON.stringify(lockOut)});` : ""}process.exit(${lockOk ? 0 : 1});`);
  const reach = mk("reach", "console.log('Sent');");
  const env = { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_APPS_BIN: apps, ORION_LOCK_BIN: lock, ORION_REACH_BIN: reach, ORION_SHUTDOWN_NO_FOLLOW: "1" };
  const cli = (args, now = D(3, 23, 50)) => { const r = spawnSync("node", [join(root, "orion-bedtime-shutdown"), ...args, "--json", "--now", now.toISOString()], { env, encoding: "utf8" }); return { ...r, out: r.stdout.trim() ? JSON.parse(r.stdout.trim().split("\n").at(-1)) : null }; };
  const log = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const state = () => JSON.parse(readFileSync(join(dir, "bedtime-shutdown.json"), "utf8"));
  const sig = (mac) => writeFileSync(join(dir, "focus-activity.json"), JSON.stringify({ ...mac, at: new Date().toISOString() }));
  return { dir, cli, log, state, sig };
}

test("run: quit-unused with everything, then lock, then arm the guard", () => {
  const t = rig();
  const r = t.cli(["run"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(t.log().map((c) => c.bin), ["apps", "lock"]);
  assert.deepEqual(t.log()[0].args, ["quit-unused", "--all", "--json"]);
  assert.equal(r.out.ok, true);
  assert.equal(r.out.locked, true);
  assert.deepEqual(r.out.closed, ["Safari", "Discord"]);
  assert.equal(r.out.armed, true);
  assert.equal(t.state().armed, true);
  assert.match(r.out.say, /Closed Safari and Discord/);
  assert.match(r.out.say, /locked/i);
});

test("run: an app waiting on unsaved work is reported, left open, and the Mac is still locked", () => {
  const t = rig({ appsJson: { ok: true, closed: ["Discord"], results: [{ name: "Discord", state: "closed" }, { name: "Word", state: "asking_to_save", document: true }], say: "Closed Discord. Word is asking to save, so I left it open for you." } });
  const r = t.cli(["run"]);
  assert.deepEqual(r.out.waitingToSave, ["Word"]);
  assert.match(r.out.say, /Word is waiting on a save/);
  assert.equal(r.out.locked, true);
});

test("run: when the lock fails it says so and never claims the Mac is locked", () => {
  const t = rig({ lockOk: false });
  const r = t.cli(["run"]);
  assert.equal(r.out.locked, false);
  assert.equal(r.out.ok, false);
  assert.match(r.out.say, /couldn't lock/i);
  assert.doesNotMatch(r.out.say, /Mac is locked|and locked it/i);
});

test("run: when orion-apps fails it still locks and says the apps are still open", () => {
  const t = rig({ appsJson: { ok: false, error: "boom", say: "I couldn't do that with your apps." } });
  const r = t.cli(["run"]);
  assert.equal(r.out.locked, true);
  assert.match(r.out.say, /couldn't close/i);
});

test("run --dry-run touches nothing: no lock, no state, quit-unused is told --dry-run", () => {
  const t = rig();
  const r = t.cli(["run", "--dry-run"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(t.log().map((c) => c.bin), ["apps"]);
  assert.ok(t.log()[0].args.includes("--dry-run"));
  assert.equal(existsSync(join(t.dir, "bedtime-shutdown.json")), false);
  assert.equal(r.out.dryRun, true);
});

test("run outside the window still shuts down (he asked) but does not arm the guard", () => {
  const t = rig();
  const r = t.cli(["run"], D(3, 18));
  assert.equal(r.out.locked, true);
  assert.equal(r.out.armed, false);
});

test("guard tick: used Mac gets one quiet nudge, then a lock; a pass holds it; the override turns it off", () => {
  const t = rig();
  t.cli(["run"], D(3, 23, 40));
  t.sig(using);
  const n = t.cli(["guard"], D(3, 23, 50));
  assert.equal(n.out.action, "nudge");
  const reach = t.log().find((c) => c.bin === "reach");
  assert.match(reach.args[0], /past your bedtime/);
  assert.match(reach.args[0], /lock it again in 2 minutes/);
  assert.ok(reach.args.includes("--silent") && reach.args.includes("--awake") && reach.args.includes("--no-queue"));
  assert.equal(t.cli(["guard"], D(3, 23, 51)).out.action, "none");
  assert.equal(t.cli(["guard"], D(3, 23, 52, 5)).out.action, "lock");
  assert.equal(t.log().filter((c) => c.bin === "lock").length, 2);   // the shutdown's lock and this one
  const p = t.cli(["pass", "20"], D(3, 23, 58));
  assert.equal(p.out.minutes, 20);
  assert.match(p.out.say, /20 minutes/);
  assert.equal(t.cli(["guard"], D(4, 0, 10)).out.action, "none");
  t.cli(["override", "on"], D(4, 0, 11));
  assert.equal(t.cli(["guard"], D(4, 0, 30)).out.action, "none");
  assert.equal(t.cli(["guard"], D(4, 0, 50)).out.why, "override");
});

test("guard --dry-run decides but neither locks nor writes", () => {
  const t = rig();
  t.cli(["run"], D(3, 23, 40));
  t.sig(using);
  const before = readFileSync(join(t.dir, "bedtime-shutdown.json"), "utf8");
  const seen = t.log().length;
  const g = t.cli(["guard", "--dry-run"], D(3, 23, 50));
  assert.equal(g.out.action, "nudge");
  assert.equal(t.log().length, seen);
  assert.equal(readFileSync(join(t.dir, "bedtime-shutdown.json"), "utf8"), before);
});

test("guard ignores a stale Mac reading", () => {
  const t = rig();
  t.cli(["run"], D(3, 23, 40));
  writeFileSync(join(t.dir, "focus-activity.json"), JSON.stringify({ ...using, at: "2026-11-03T20:00:00Z" }));
  assert.equal(t.cli(["guard"], D(3, 23, 50)).out.action, "none");
});

test("the sleep-nudge lockdown does not arm the guard on a failed lock, and its message never claims a lock that failed", () => {
  const dir = mkdtempSync(join(tmpdir(), "nudge-lock-"));
  const calls = join(dir, "calls.jsonl");
  const mk = (name, code = 0) => { const f = join(dir, name); writeFileSync(f, `#!/usr/bin/env node\nrequire("fs").appendFileSync(${JSON.stringify(calls)}, JSON.stringify({bin:${JSON.stringify(name)},args:process.argv.slice(2)})+"\\n");process.exit(${name === "act" ? 1 : code});\n`); chmodSync(f, 0o755); return f; };
  writeFileSync(join(dir, "wake-plan.json"), JSON.stringify(plan()));
  writeFileSync(join(dir, "sleep-nudge-state.json"), JSON.stringify({ evening: "2026-11-03", wakeIso: D(4, 6).toISOString(), done: ["nudge", "bedtime", "firm", "warn", "dim"], warnAt: D(3, 22, 53).toISOString(), held: { groups: ["games", "video"], dimmed: true, locked: false } }));
  const env = { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_REACH_BIN: mk("reach"), ORION_BEDTIME_ACT_BIN: mk("act"), ORION_PHONE_TIME_BIN: mk("phone"), ORION_SHUTDOWN_NO_FOLLOW: "1" };
  const sig = join(dir, "signals.json");
  writeFileSync(sig, JSON.stringify({ mac: upMac, phone: {}, calendar: [] }));
  const r = spawnSync("node", [join(root, "orion-sleep-nudge"), "tick", "--json", "--now", D(4, 0, 5).toISOString(), "--signals", sig], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const reach = readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((c) => c.bin === "reach");
  assert.doesNotMatch(reach.args[0], /locked the Mac/);
  assert.match(reach.args[0], /wouldn't lock/);
  assert.equal(existsSync(join(dir, "bedtime-shutdown.json")), false);   // a failed lock arms nothing
});

// ---- review fixes (2026-11-04) ----
test("lockMac: a method that returned 0 but did not lock the screen is not reported as a lock", async () => {
  const seen = [];
  const exec = async (cmd) => { seen.push(cmd); return { status: 0 }; };
  const r = await lockMac({ exec, verify: async () => false, bridge: "bridge", osascript: "osascript", pmset: "pmset" });
  assert.deepEqual([r.ok, r.method, r.locked], [true, "display-sleep", false]);   // display asleep, said so, never "locked"
  const v = await lockMac({ exec, verify: async () => true, bridge: "bridge", osascript: "osascript", pmset: "pmset" });
  assert.deepEqual([v.method, v.locked], ["bridge", true]);
});

function planFile(over) {
  const dir = mkdtempSync(join(tmpdir(), "win-"));
  writeFileSync(join(dir, "wake-plan.json"), JSON.stringify({ source: "nick", alarms: [], bedtimes: [{ nudgeAtIso: D(3, 21, 30).toISOString() }], ...over }));
  return dir;
}
test("the window never spans days: capped at 14 hours and at 10:00 the next morning", () => {
  const far = planFile({ alarms: [{ iso: D(6, 7).toISOString(), byNick: true }] });
  assert.equal(tonightWindow(far, D(4, 1)).end.getTime(), D(4, 10).getTime());
  const late = planFile({ bedtimes: [{ nudgeAtIso: D(3, 23).toISOString() }], alarms: [{ iso: D(6, 7).toISOString(), byNick: true }] });
  assert.equal(tonightWindow(late, D(4, 1)).end.getTime(), D(4, 10).getTime());
  const early = planFile({ bedtimes: [{ nudgeAtIso: D(4, 0, 30).toISOString() }], alarms: [{ iso: D(6, 7).toISOString(), byNick: true }] });
  assert.equal(tonightWindow(early, D(4, 1)).end.getTime(), D(4, 10).getTime());
  const near = planFile({ alarms: [{ iso: D(4, 6).toISOString(), byNick: true }] });
  assert.equal(tonightWindow(near, D(3, 23)).end.getTime(), D(4, 6).getTime());
});

test("passes total at most 90 minutes a night, then it says so", () => {
  let st = armNight(emptyState(), win, D(3, 23, 40));
  const a = grantPass(st, 60, D(3, 23, 50));
  const b = grantPass(a.state, 60, D(4, 0, 50));
  assert.equal(b.minutes, 30);
  assert.equal(b.capped, true);
  const c = grantPass(b.state, 15, D(4, 1, 20));
  assert.equal(c.minutes, 0);
  assert.equal(c.exhausted, true);
  assert.equal(passActive(c.state, D(4, 1, 25)), false);
  assert.equal(PASS_NIGHT_MAX_MIN, 90);
  assert.equal(armNight(c.state, { start: D(4, 21, 30), end: D(5, 6) }, D(4, 22)).passTotal, 0);
});

test("run clears an earlier override; a lock that is only display sleep says so and a failed lock does not arm", () => {
  const t = rig();
  t.cli(["run"], D(3, 23, 40));
  t.cli(["override", "on"], D(3, 23, 45));
  assert.equal(t.state().override, true);
  t.cli(["run"], D(3, 23, 50));
  assert.equal(t.state().override, false);
  const bad = rig({ lockOk: false });
  assert.equal(bad.cli(["run"], D(3, 23, 50)).out.armed, false);
  assert.equal(existsSync(join(bad.dir, "bedtime-shutdown.json")), false);
});

test("the pass command says when the night's passes are used up", () => {
  const t = rig();
  t.cli(["run"], D(3, 23, 40));
  t.cli(["pass", "60"], D(3, 23, 50));
  t.cli(["pass", "60"], D(4, 0, 55));
  const r = t.cli(["pass", "10"], D(4, 1, 30));
  assert.equal(r.out.minutes, 0);
  assert.match(r.out.say, /90 minutes/);
});

test("run: display sleep alone is said as the display being asleep, never as locked", () => {
  const t = rig({ lockOut: JSON.stringify({ method: "display-sleep", locked: false }) });
  const r = t.cli(["run"]);
  assert.equal(r.out.locked, false);
  assert.match(r.out.say, /display's asleep/);
  assert.doesNotMatch(r.out.say, /Mac is locked/);
});
