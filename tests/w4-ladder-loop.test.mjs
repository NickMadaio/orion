// The closing loop, end to end through the real orion-checkin (2026-10-30, W4): grace and comeback, declared facts, gym
// evidence, the Mac voice at L2, permitted restriction, the now record holding a rung, the reply handle, ladders.json.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { world, at, planCheckin, rows } from "./incident-world.mjs";

const D = 30;
const GYM = { date: "2026-10-30", start: 1020, end: 1110 };   // 17:00-18:30
const mins = (d) => Math.floor(d.getTime() / 60000);
const gymLoop = (over = {}) => planCheckin("ci-gym", "Gym", "cal-gym", { createdAt: at(D, 17, 5).toISOString(), nextCheckAt: mins(at(D, 17, 5)), blockWindow: GYM, tier: "protected", ...over });
function setup(over = {}, cfg = {}) {
  const w = world({ day: D, cfg, checkins: [gymLoop(over)] });
  const reach = w.bin("fake-reach", `echo "$@" >> "${w.home}/reach.log"; echo "Sent - fake"`);
  const resched = w.bin("fake-resched", `echo "$@" >> "${w.home}/resched.log"; echo "  re-entered Gym: 20:00–21:30"`);
  const extra = { ORION_REACH_BIN: reach, ORION_RESCHEDULE_BIN: resched, ORION_PATTERNS_FILE: join(w.dir, "patterns.json"), ORION_LIFE_HISTORY: join(w.dir, "life-history.jsonl") };
  const tick = (h, m, o = {}) => w.run("orion-checkin", ["tick", "--json"], h, m, { extra, ...o });
  const cmd = (args, h, m) => w.run("orion-checkin", args, h, m, { extra });
  const ladders = () => JSON.parse(readFileSync(join(w.dir, "ladders.json"), "utf8"));
  return { w, tick, cmd, calls: () => w.lines("reach.log"), ladders, extra };
}

test("'I'm meal prepping' after L0 is a 25-min grace and a comeback, then the ladder goes on from L1", () => {
  const s = setup();
  s.tick(17, 5);
  assert.match(s.calls()[0], /^Time to start: Gym\./);
  const r = s.cmd(["defer", "25", "ci-gym", "--because", "I'm meal prepping. That's why. Sorry."], 17, 7);
  assert.match(r.stdout, /^Fair — back in 25 min about Gym\./, "10-20: this was 'What time or how long do you mean?' and a dead end");
  assert.equal(s.ladders().ladders[0].status, "grace");
  assert.equal(s.ladders().ladders[0].resolution.replyTo, "ci-gym-L0", "the reply names the message it answers");
  s.tick(17, 20); assert.equal(s.calls().length, 1, "nothing during the grace");
  s.tick(17, 32);
  assert.equal(s.calls().at(-1).split(" --")[0], "Time to start: Gym. Okay, meal prep's done. Now we're starting.");
  s.tick(17, 42);
  assert.match(s.calls().at(-1), /^Gym — still not started\. Just 30 min then/);
  assert.equal(s.ladders().ladders[0].status, "open");
});

test("avoidance is not a grace: the defer is refused and the ladder turns firm", () => {
  const s = setup();
  s.tick(17, 5);
  const r = s.cmd(["defer", "15", "ci-gym", "--because", "later"], 17, 6);
  assert.match(r.stdout, /^That reads as putting it off/);
  s.tick(17, 16);
  assert.match(s.calls().at(-1), /^Gym — still not started\. Just 30 min then, and it starts now\./);
});

test("a declared 'skip' closes the ladder with no message and a missed sample in patterns", () => {
  const s = setup();
  writeFileSync(join(s.w.dir, "declared-facts.json"), JSON.stringify({ schemaVersion: 1, facts: [{ id: "f1", date: "2026-10-30", at: at(D, 16, 0).toISOString(), kind: "skip", text: "i didnt go to the gym, skipping it today", source: "chat", title: "Gym" }] }));
  s.tick(17, 5);
  assert.equal(s.calls().length, 0);
  assert.equal(s.ladders().ladders[0].status, "declared");
  const hist = rows(join(s.w.dir, "life-history.jsonl"));
  assert.equal(hist.at(-1).kind, "gym"); assert.equal(hist.at(-1).actualStart, null);
});

test("a WHOOP workout today marks the gym done (patterns and ladders.json), and nothing more is sent", () => {
  const s = setup({ alerts: 1, phase: "reminded", nextCheckAt: mins(at(D, 17, 15)) });
  const log = { workouts: [{ day: "2026-10-30", startedAt: at(D, 17, 12).toISOString(), title: "Weightlifting", source: "whoop" }] };
  writeFileSync(join(s.w.dir, "health-log.json"), JSON.stringify(log));
  s.tick(17, 16);
  assert.equal(s.calls().length, 0);
  const l = s.ladders();
  assert.equal(l.ladders[0].status, "done"); assert.equal(l.ladders[0].resolution.how, "evidence:whoop");
  assert.equal(l.attended[0].source, "whoop");
  assert.equal(rows(join(s.w.dir, "life-history.jsonl")).at(-1).actualStart, 1032);
  assert.equal(JSON.parse(readFileSync(join(s.w.dir, "patterns.json"), "utf8")).byKind.gym.happened, 1);
});

test("L2 is a time-sensitive phone push and, at home, the Mac says it aloud too", () => {
  const s = setup({ alerts: 2, phase: "intervening", nextCheckAt: mins(at(D, 17, 25)) });
  s.tick(17, 25);
  const [push, voice] = s.calls();
  assert.match(push, /^It's been 25 min\. Gym, now\..* --urgent --urgent-kind plan --channel phone/);
  assert.match(voice, /^Nick\. Gym\. Now\. 30 minutes still counts\..* --channel mac/);
  assert.deepEqual(s.ladders().ladders[0].messages[0].channels, ["phone-time-sensitive", "mac-voice"]);
});

test("L3 restricts only with the grant and the app's consent; in a state copy that goes to the outbox", () => {
  const activity = (w) => writeFileSync(join(w.dir, "focus-activity.json"), JSON.stringify({ at: at(D, 17, 44).toISOString(), enforcementAllowed: true, workApp: "Zed" }));
  const no = setup({ alerts: 3, phase: "intervening", nextCheckAt: mins(at(D, 17, 45)) });
  activity(no.w); no.tick(17, 45);
  assert.match(no.calls()[0], /^You've been avoiding Gym for 45 min\. /);
  assert.equal(existsSync(join(no.w.dir, "isolated-outbox.jsonl")), false, "not granted: no restriction");
  const yes = setup({ alerts: 3, phase: "intervening", nextCheckAt: mins(at(D, 17, 45)) }, { escalation: { restrict: true } });
  activity(yes.w); yes.tick(17, 45);
  assert.match(yes.calls()[0], /I've locked the Mac until you go\./);
  assert.equal(rows(join(yes.w.dir, "isolated-outbox.jsonl"))[0].channel, "focus-restrict");
});

test("END: the day is re-weighed and he is told where the gym went; the loop never ends silently", () => {
  const s = setup({ alerts: 4, phase: "intervening", nextCheckAt: mins(at(D, 18, 5)) });
  s.tick(18, 5);
  assert.equal(s.w.lines("resched.log")[0], "displace Gym --why gave-up");
  assert.match(s.calls()[0], /^Gym didn't happen at 5:00 PM\. I've moved it to 8:00 PM–9:30 PM; that's the plan now\. If today's off, say skip\..* --tier protected/);
  assert.equal(s.ladders().ladders[0].status, "replanned");
  s.tick(18, 10); assert.equal(s.calls().length, 1);
});

test("a fresh now record that says something else matters now holds the rung", () => {
  const s = setup();
  writeFileSync(join(s.w.dir, "now.json"), JSON.stringify({ schemaVersion: 1, computedAt: at(D, 17, 3).toISOString(), shouldBe: { kind: "travel", blockId: "cal-class" }, mismatch: null, declared: [], slipsToday: [], strictness: "flexible" }));
  s.tick(17, 5);
  assert.equal(s.calls().length, 0);
});

test("find --msg finds the loop a reply is about, by the id the message carried", () => {
  const s = setup();
  s.tick(17, 5);
  const r = s.cmd(["find", "--msg", "ci-gym-L0"], 17, 6);
  assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).id, "ci-gym");
  assert.equal(s.cmd(["find", "--msg", "nope"], 17, 6).status, 1);
});
