import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-bedtime-act");

// A mock bridge: records the request line and answers ok (or an error when the bundle id says so).
function mock() {
  const dir = mkdtempSync(join(tmpdir(), "bedtime-act-"));
  const log = join(dir, "request.json");
  const bin = join(dir, "bridge");
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require("fs");
const line = fs.readFileSync(0, "utf8").trim();
fs.writeFileSync(${JSON.stringify(log)}, line);
const req = JSON.parse(line);
if (req.payload.bundle_id === "com.apple.finder") { console.log(JSON.stringify({ id: req.id, ok: false, error: "I will not quit that one." })); process.exit(0); }
console.log(JSON.stringify({ id: req.id, ok: true, result: { status: "done", action_seen: req.action } }));
`);
  chmodSync(bin, 0o755);
  return { bin, log };
}

// tonight's plan: nudge 23:00 Mon 2026-11-02, alarm 07:00 Tue (class) -> window 23:00 .. 07:00.
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).toISOString();
function planDir(doc) {
  const dir = mkdtempSync(join(tmpdir(), "bedtime-plan-"));
  if (doc) writeFileSync(join(dir, "wake-plan.json"), JSON.stringify(doc));
  return dir;
}
const NICK = () => ({ source: "nick", alarms: [{ date: "2026-11-03", at: "07:00", iso: at(3, 7), reason: "class", byNick: true }],
  bedtimes: [{ date: "2026-11-02", sleepBy: "23:30", nudgeAt: "23:00", sleepByIso: at(2, 23, 30), nudgeAtIso: at(2, 23) }] });
let controlled = planDir(NICK());
const run = (bin, ...args) => {
  const now = args.includes("--now") ? [] : ["--now", at(3, 0, 30)];
  return spawnSync("node", [script, ...args, ...now], { env: { ...process.env, ORION_MAC_BRIDGE: bin, ORION_CONTROLLED_DIR: controlled }, encoding: "utf8" });
};

test("quit-app sends quit_app with the bundle id and prints the bridge's answer", () => {
  const { bin, log } = mock();
  const r = run(bin, "quit-app", "com.hnc.Discord");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(log, "utf8")).payload, { bundle_id: "com.hnc.Discord" });
  assert.deepEqual(JSON.parse(r.stdout), { action: "quit-app", status: "done", action_seen: "quit_app" });
});

test("lock-screen, dim and undim map to their bridge methods", () => {
  for (const [cmd, method] of [["lock-screen", "lock_screen"], ["dim", "dim"], ["undim", "undim"]]) {
    const { bin, log } = mock();
    const r = run(bin, cmd);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(log, "utf8")).action, method);
  }
});

test("a bridge refusal is a non-zero exit with the reason, not a success line", () => {
  const { bin } = mock();
  const r = run(bin, "quit-app", "com.apple.finder");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /distraction/i);
  assert.equal(r.stdout, "");
});

test("bad usage and shell-shaped bundle ids never reach the bridge", () => {
  const { bin, log } = mock();
  assert.equal(run(bin).status, 2);
  assert.equal(run(bin, "quit-app").status, 2);
  assert.equal(run(bin, "quit-app", "x; rm -rf ~").status, 2);
  assert.equal(run(bin, "reboot").status, 2);
  assert.throws(() => readFileSync(log, "utf8"));
});

test("quit-app takes only distraction apps; Atlas, editors, calls and recorders are refused without reaching the bridge", () => {
  for (const id of ["com.nickmadaio.atlas", "com.apple.dt.Xcode", "com.microsoft.VSCode", "com.anthropic.claudefordesktop", "us.zoom.xos",
    "com.microsoft.teams2", "com.apple.FaceTime", "com.apple.QuickTimePlayerX", "com.apple.VoiceMemos", "com.apple.finder"]) {
    const { bin, log } = mock();
    const r = run(bin, "quit-app", id);
    assert.notEqual(r.status, 0, id);
    assert.match(r.stderr, /distraction/i, id);
    assert.throws(() => readFileSync(log, "utf8"), id);
  }
  for (const id of ["com.mojang.minecraftlauncher", "com.valvesoftware.steam", "com.google.Chrome", "com.apple.Safari", "company.thebrowser.Browser",
    "com.hnc.Discord", "com.apple.TV", "com.roblox.RobloxPlayer", "com.curseforge.CurseForge", "org.mozilla.firefox"]) {
    const { bin } = mock();
    assert.equal(run(bin, "quit-app", id).status, 0, id);
  }
});

test("quit-app and lock-screen are refused outside tonight's window; dim and undim run any time", () => {
  const cases = [at(2, 22, 59), at(3, 7, 0), at(3, 12, 0)];   // before the nudge, at the alarm, midday
  for (const now of cases) {
    for (const args of [["quit-app", "com.hnc.Discord"], ["lock-screen"]]) {
      const { bin, log } = mock();
      const r = run(bin, ...args, "--now", now);
      assert.equal(r.status, 1, `${args[0]} at ${now}`);
      assert.match(r.stderr, /bedtime|window|tonight/i);
      assert.throws(() => readFileSync(log, "utf8"));
    }
    for (const cmd of ["dim", "undim"]) assert.equal(run(mock().bin, cmd, "--now", now).status, 0);
  }
  assert.equal(run(mock().bin, "lock-screen", "--now", at(2, 23, 0)).status, 0, "window opens at the nudge");
});

test("no plan, a default plan, or a broken one means no window", () => {
  for (const doc of [null, { ...NICK(), source: "default" }]) {
    controlled = planDir(doc);
    const r = run(mock().bin, "lock-screen");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /plan/i);
  }
  controlled = planDir(null);
  writeFileSync(join(controlled, "wake-plan.json"), "{nope");
  assert.equal(run(mock().bin, "lock-screen").status, 1);
  controlled = planDir(NICK());
});

test("with no alarm ahead the window runs until 09:00", () => {
  controlled = planDir({ ...NICK(), alarms: [] });
  assert.equal(run(mock().bin, "lock-screen", "--now", at(3, 8, 59)).status, 0);
  assert.equal(run(mock().bin, "lock-screen", "--now", at(3, 9, 1)).status, 1);
  controlled = planDir(NICK());
});
