// orion-watch end to end at fake times: an all-nighter flagged at 03:10, stated plainly in the 08:00 brief, sensors told once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WATCH = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-watch");
const dir = mkdtempSync(join(tmpdir(), "orion-allnighter-"));
const ev = (title, s, e, orion) => ({ title, start: `2026-11-02T${s}:00Z`, end: `2026-11-02T${e}:00Z`, allDay: "false", identifier: title.replace(/\W/g, ""), ...(orion ? { orion, orionTags: orion } : {}) });
const scenario = { events: [ev("CS2100 Lab", "09:00", "10:30"), ev("Study for CS midterm", "10:45", "12:15", "study"), ev("Gym", "17:30", "19:00", "gym")], deadlines: [], todos: [{ title: "finish resume" }] };
writeFileSync(join(dir, "scenario.json"), JSON.stringify(scenario));
const bridge = join(dir, "bridge.sh");
writeFileSync(bridge, `#!/bin/sh\nnode -e '\nconst fs=require("fs");const req=JSON.parse(fs.readFileSync(0,"utf8").split("\\n").find(l=>l.trim().startsWith("{")));\nconst sc=JSON.parse(fs.readFileSync(process.env.SCENARIO,"utf8"));\nconst r={list_upcoming_calendar_events:{events_json:JSON.stringify(sc.events)},list_deadlines:{events_json:"[]"},list_incomplete_reminders:{reminders_json:JSON.stringify(sc.todos)}}[req.action]||{events_json:"[]",reminders_json:"[]"};\nconsole.log(JSON.stringify({id:req.id,ok:true,result:r}))'\n`);
chmodSync(bridge, 0o755);
writeFileSync(join(dir, "health-log.json"), JSON.stringify({ days: {}, phoneSignals: [{ at: "2026-10-26T18:03:46Z", charging: false, motion: "vehicle" }], sleepLog: [] }));
writeFileSync(join(dir, "life-config.json"), JSON.stringify({ anchors: [{ title: "Gym", kind: "gym", minutes: 90, days: [1, 2, 3, 4, 5, 6, 7], rank: "must" }] }));

const tick = (now) => {
  const r = spawnSync(process.execPath, [WATCH, "tick", "--json"], { encoding: "utf8", timeout: 60000,
    env: { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(dir, "life-config.json"), ORION_NOW: now, ORION_BRIDGE_READ_BIN: bridge, SCENARIO: join(dir, "scenario.json"), ORION_EVAL_MARKER: join(dir, "no-eval") } });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").at(-1));
};

test("03:10 awake on a class night: flagged, a proposal for the day, nothing sent", () => {
  writeFileSync(join(dir, "focus-activity.json"), JSON.stringify({ at: "2026-11-02T03:09:30Z", app: "Xcode", idleSeconds: 10, locked: false, displayAsleep: false, idleValid: true }));
  assert.deepEqual(tick("2026-11-02T03:10:00Z"), []);
  const flag = JSON.parse(readFileSync(join(dir, "awake-late.json"), "utf8"));
  assert.equal(flag.targetDate, "2026-11-02"); assert.deepEqual(flag.evidence, ["mac active"]);
  assert.match(flag.message, /3:10 AM and CS2100 Lab is at 9:00 AM/); assert.match(flag.message, /Go to bed\./);
  assert.match(flag.proposal.text, /CS2100 Lab at 9:00 AM stays/); assert.match(flag.proposal.text, /nap/i); assert.match(flag.proposal.text, /Gym stays full length as an easier session/);   // 2026-10-31 policy: the gym keeps its 90
});

test("08:00 after that night: the brief states the proposal and the dead phone once", () => {
  writeFileSync(join(dir, "focus-activity.json"), JSON.stringify({ at: "2026-11-02T07:59:30Z", app: "Safari", idleSeconds: 5, locked: false, displayAsleep: false, idleValid: true }));
  const log = JSON.parse(readFileSync(join(dir, "health-log.json"), "utf8"));
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ ...log, days: { "2026-11-02": { recovery: 1, sleepHours: 3.7, updatedAt: "2026-11-02T07:50:00Z" } } }));
  const [brief] = tick("2026-11-02T08:00:00Z");
  assert.match(brief.text, /Short night — 3\.7h\. Proposal: CS2100 Lab at 9:00 AM stays/);
  assert.match(brief.text, /Your phone hasn't reported since Oct 26 - open ORION on it\./);
  assert.equal(brief.text.match(/CS2100 Lab at 9:00 AM/g).length, 1);
  assert.doesNotMatch(brief.text, /^Morning\. Morning/);
  assert.deepEqual(tick("2026-11-02T08:05:00Z"), []);   // told once
});
