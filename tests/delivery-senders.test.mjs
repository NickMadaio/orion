// Every script sender against the one gate, with a fake awareness file: held vs delivered.
// orion-checkin (scenarios 4 and 13), orion-notify, orion-watch, orion-standing.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { harness } from "./delivery-helpers.mjs";

const NOW_REAL = () => new Date();
const min = () => Math.floor(Date.now() / 60000);
const loop = (id) => ({ blockId: id, phase: "waiting", level: 0, nextCheckAt: min() - 5, deferrals: 0, history: [] });
const checkin = (id, by, extra = {}) => ({ id, what: `start ${id}`, by, dueAt: min() - 5, createdAt: new Date().toISOString(), alerts: 0, returning: null, loop: loop(id), ...extra });
const state = (h, session, sleep = "awake") => h.setAwareness({ session: { state: session, at: new Date().toISOString() }, sleep: { state: sleep, at: new Date().toISOString() } }, NOW_REAL());
const tick = (h) => JSON.parse(h.run("orion-checkin", ["tick", "--json"]).stdout).map((a) => a.id);

test("scenario 4: an orion check-in is held during focus and fires on the break; one he set fires through focus", () => {
  const h = harness();
  writeFileSync(h.env.ORION_CHECKIN_FILE, JSON.stringify({ checkins: [checkin("ci-mine", "nick"), checkin("ci-orion", "orion")] }));
  state(h, "focus");
  assert.deepEqual(tick(h), ["ci-mine"]);
  state(h, "rest");
  const saved = JSON.parse(readFileSync(h.env.ORION_CHECKIN_FILE, "utf8"));
  assert.equal(saved.checkins.find((c) => c.id === "ci-orion").alerts, 0, "held loops do not climb");
  assert.deepEqual(tick(h), ["ci-orion"], "released at the break");
});

test("scenario 4: both kinds are held in quiet hours", () => {
  const h = harness();
  writeFileSync(h.env.ORION_CHECKIN_FILE, JSON.stringify({ checkins: [checkin("ci-mine", "nick"), checkin("ci-orion", "orion")] }));
  state(h, "none", "asleep");
  assert.deepEqual(tick(h), []);
  state(h, "none", "awake");
  assert.deepEqual(tick(h).sort(), ["ci-mine", "ci-orion"]);
});

test("scenario 13 (check-in side): a plan loop climbs levels 1-4 through orion-reach, the 5th alert closes it and spawns displace", () => {
  const h = harness();
  state(h, "none");
  const add = h.run("orion-checkin", ["add", "0", "finish resume", "--by", "orion", "--block", "blk-1", "--window", "14:00-16:00"]);
  assert.equal(add.status, 0, add.stderr);
  const due = () => { const s = JSON.parse(readFileSync(h.env.ORION_CHECKIN_FILE, "utf8")); s.checkins[0].loop.nextCheckAt = min() - 1; writeFileSync(h.env.ORION_CHECKIN_FILE, JSON.stringify(s)); };
  const stdout = [];
  for (let i = 0; i < 5; i++) { due(); state(h, "none"); stdout.push(...tick(h)); }
  assert.deepEqual(stdout, [], "plan alerts go through orion-reach, not the phone outbox");
  const calls = h.lines("reach.log");
  assert.equal(calls.length, 5);
  const levels = calls.map((l) => JSON.parse(l.slice(l.indexOf("--ask ") + 6).replace(/^'|'$/g, "")).level);
  assert.deepEqual(levels, [1, 2, 3, 4, 5]);
  for (const l of calls) assert.match(l, /--kind checkin --why plan: blk-1 --ask /);
  assert.match(calls[4], /I'll stop pinging about finish resume/);
  assert.deepEqual(h.lines("reschedule.log"), ["displace finish resume --why gave-up"]);
  due(); state(h, "none");
  assert.deepEqual(tick(h), []); assert.equal(h.lines("reach.log").length, 5, "closed: nothing more");
});

test("a plan loop is held (not stepped) during focus; cancelling one re-weighs the day", () => {
  const h = harness();
  h.run("orion-checkin", ["add", "0", "finish resume", "--by", "orion", "--block", "blk-1"]);
  const s = JSON.parse(readFileSync(h.env.ORION_CHECKIN_FILE, "utf8")); s.checkins[0].loop.nextCheckAt = min() - 1; writeFileSync(h.env.ORION_CHECKIN_FILE, JSON.stringify(s));
  state(h, "focus"); tick(h);
  assert.equal(h.lines("reach.log").length, 0);
  assert.equal(h.run("orion-checkin", ["cancel"]).status, 0);
  assert.deepEqual(h.lines("reschedule.log"), ["displace finish resume --why cancel"]);
});

const notifyEnv = (h) => { const bin = join(h.home, "discord"); writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${h.home}/discord.log"\n`); chmodSync(bin, 0o755); return { ORION_DISCORD_ALERT_BIN: bin }; };

test("orion-notify: focus and sleep defer, a break delivers, blocked always goes; the fixed hours are only a fallback", () => {
  const h = harness(); const env = notifyEnv(h);
  const send = (msg, at = "2026-10-16T14:00:00", ev = "milestone") => h.run("orion-notify", [ev, "standing-check", msg, "--now", at], env).stdout;
  const stamp = (at) => new Date(at).toISOString();
  const aw = (session, sleep, at) => h.setAwareness({ session: { state: session, at: stamp(at) }, sleep: { state: sleep, at: stamp(at) } }, new Date(at));
  aw("focus", "awake", "2026-10-16T14:00:00");
  assert.match(send("A"), /deferred \(focus session/);
  assert.match(send("B", undefined, "blocked"), /sent/);
  aw("rest", "awake", "2026-10-16T14:05:00");
  assert.match(send("C", "2026-10-16T14:05:00"), /sent/);
  aw("none", "asleep", "2026-10-16T14:30:00");
  assert.match(send("D", "2026-10-16T14:30:00"), /deferred \(quiet/);
  aw("none", "awake", "2026-10-16T03:00:00");
  assert.match(send("E", "2026-10-16T03:00:00"), /sent/, "awake at 3 AM: his sleep decides, not the clock");
});

test("orion-notify flush: held in focus, released once on a break", () => {
  const h = harness(); const env = notifyEnv(h);
  const at = "2026-10-16T14:00:00"; const stamp = new Date(at).toISOString();
  h.setAwareness({ session: { state: "focus", at: stamp } }, new Date(at));
  h.run("orion-notify", ["milestone", "standing-check", "Digest", "--now", at], env);
  assert.match(h.run("orion-notify", ["flush", "--now", at], env).stdout, /not flushing/);
  h.setAwareness({ session: { state: "rest", at: stamp } }, new Date(at));
  h.run("orion-notify", ["flush", "--now", at], env);
  assert.match(readFileSync(join(h.home, "discord.log"), "utf8"), /HELD UPDATES/);
});

test("orion-watch: alerts wait in the held queue during focus (heldFor focus), a class reminder does not", () => {
  const h = harness();
  const d = new Date(); const t = (hh, mm) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).toISOString();
  writeFileSync(join(h.home, "cal.json"), JSON.stringify([{ identifier: "cs", title: "CS1800 Discrete Structures — Lecture", start: t(9, 0), end: t(10, 30) }]));
  writeFileSync(join(h.home, "watch.json"), "{}");
  state(h, "focus");
  const env = { HOME: h.home, ORION_WATCH_FILE: join(h.home, "watch.json"), ORION_HEALTH_LOG: join(h.dir, "health-log.json") };
  const r = h.run("orion-watch", ["tick", "--at", "08:52"], env);
  assert.equal(r.status, 0, r.stderr);
  const sent = h.read("alerts-outbox.jsonl").map((a) => a.id);
  assert.ok(sent.some((id) => id.startsWith("class-")), `class goes: ${sent}`);
  assert.ok(!sent.includes("watch-brief"), "the brief waits");
  assert.ok(h.read("held.jsonl").some((e) => /^Morning\./.test(e.text) && e.via === "alerts-outbox" && e.heldFor === "focus"));
});

test("orion-standing: an urgent finding is sent as a milestone with no --urgent and no blocked bypass", () => {
  const src = readFileSync(join(import.meta.dirname, "../scripts/orion-standing"), "utf8");
  assert.ok(existsSync(join(import.meta.dirname, "../scripts/orion-standing")));
  assert.doesNotMatch(src, /"--urgent"/);
  assert.doesNotMatch(src, /"blocked" : "milestone"/);
  assert.match(src, /gate\(resolveAwareness/);
});
