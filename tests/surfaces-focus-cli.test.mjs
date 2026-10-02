import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const script = join(import.meta.dirname, "..", "scripts", "orion-ontask");

function makeTmpDir() {
  const dir = join(tmpdir(), `orion-surfaces-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function run(args, envExtra = {}) {
  const tmpDir = makeTmpDir();
  const stateFile = join(tmpDir, "focus-state.json");
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf-8",
    env: { ...process.env, ORION_FOCUS_STATE: stateFile, ORION_FOCUS_DRY: "1", ...envExtra },
  });
  return { result, tmpDir, stateFile };
}

function readState(stateFile) {
  try {
    return JSON.parse(readFileSync(stateFile, "utf-8"));
  } catch {
    return null;
  }
}

test("status on a fresh state says nothing is set", () => {
  const { result } = run(["status", "--now", "09:00"]);
  assert.equal(result.status, 0);
  const out = result.stdout;
  assert.ok(out.includes("ladder:"), "should show ladder");
  assert.ok(out.includes("allows today:"), "should show allows count");
});

test("snooze sets snoozeUntil and logs it", () => {
  const { result, stateFile } = run(["snooze", "30", "--why", "testing", "--now", "10:00"]);
  assert.equal(result.status, 0);
  const st = readState(stateFile);
  assert.equal(st.ladder.snoozeUntil, 630, "snoozeUntil = 600 + 30");
  const logEntry = st.log.find(e => e.event === "snooze");
  assert.ok(logEntry, "should have a snooze log entry");
});

test("snooze outside 1..120 exits 2", () => {
  const { result } = run(["snooze", "0"]);
  assert.equal(result.status, 2);
  const { result: r2 } = run(["snooze", "121"]);
  assert.equal(r2.status, 2);
});

test("allow is recorded for today", () => {
  const { result, stateFile } = run(["allow", "Safari", "--block", "--until", "14:00", "--now", "10:00"]);
  assert.equal(result.status, 0);
  const st = readState(stateFile);
  const entry = st.allow[st.allow.length - 1];
  assert.equal(entry.match, "Safari");
  assert.equal(entry.until, 840);
  const logEntry = st.log.find(e => e.event === "allow");
  assert.ok(logEntry, "should have an allow log entry");
});

test("wrong resets the ladder and snoozes 15 minutes", () => {
  // First set some ladder state
  const tmpDir = makeTmpDir();
  const stateFile = join(tmpDir, "focus-state.json");
  writeFileSync(stateFile, JSON.stringify({
    ladder: { offSince: 600, lastStep: "lock", snoozeUntil: null },
    allow: [],
    log: []
  }));

  const result = spawnSync(process.execPath, [script, "wrong", "--why", "false alarm", "--now", "10:00"], {
    encoding: "utf-8",
    env: { ...process.env, ORION_FOCUS_STATE: stateFile, ORION_FOCUS_DRY: "1" },
  });
  assert.equal(result.status, 0);
  const st = readState(stateFile);
  assert.equal(st.ladder.offSince, null, "offSince reset");
  assert.equal(st.ladder.lastStep, "none", "lastStep reset");
  assert.equal(st.ladder.snoozeUntil, 615, "snoozed 15 min from 600");
  const logEntry = st.log.find(e => e.event === "wrong");
  assert.ok(logEntry, "should have a wrong log entry");
});

test("act quit in dry mode prints the osascript command", () => {
  const { result } = run(["act", "quit", "--app", "Safari"]);
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes("osascript"), "should print osascript command");
  assert.ok(result.stdout.includes("tell application \"Safari\" to quit"), "should include app name");
});

test("an app name with quotes is refused", () => {
  const { result } = run(["act", "quit", "--app", 'Saf"ari']);
  assert.equal(result.status, 2);
});

test("the log keeps at most 500 entries", () => {
  const tmpDir = makeTmpDir();
  const stateFile = join(tmpDir, "focus-state.json");
  // Write a state with 510 log entries
  const bigLog = Array.from({ length: 510 }, (_, i) => ({
    at: new Date(Date.now() + i * 60000).toISOString(),
    event: "test",
    detail: String(i)
  }));
  writeFileSync(stateFile, JSON.stringify({ ladder: {}, allow: [], log: bigLog }));

  // Run a command that reads and rewrites state (snooze writes back)
  const result = spawnSync(process.execPath, [script, "snooze", "10", "--now", "10:00"], {
    encoding: "utf-8",
    env: { ...process.env, ORION_FOCUS_STATE: stateFile, ORION_FOCUS_DRY: "1" },
  });
  assert.equal(result.status, 0);
  const st = readState(stateFile);
  assert.ok(st.log.length <= 500, `log should be capped at 500, got ${st.log.length}`);
});

test("a corrupt state file reads as empty", () => {
  const tmpDir = makeTmpDir();
  const stateFile = join(tmpDir, "focus-state.json");
  writeFileSync(stateFile, "this is not json {{{");

  const result = spawnSync(process.execPath, [script, "status"], {
    encoding: "utf-8",
    env: { ...process.env, ORION_FOCUS_STATE: stateFile, ORION_FOCUS_DRY: "1" },
  });
  assert.equal(result.status, 0);
  const out = result.stdout;
  assert.ok(out.includes("ladder:"), "should still show ladder");
});

test("act preserves a spaced app name as one argument", () => {
 const dir=makeTmpDir();const bin=join(dir,'bin');mkdirSync(bin);
 const output=join(dir,'argv.json');
 writeFileSync(join(bin,'open'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.ARGV_OUT, JSON.stringify(process.argv.slice(2)));\n`,{mode:0o755});
 const {result}=run(['act','front','--app','Visual Studio Code'], {ORION_FOCUS_DRY:'0',PATH:bin,ARGV_OUT:output});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(readFileSync(output,'utf8')),['-a','Visual Studio Code']);
});
