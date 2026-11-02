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

const run = (bin, ...args) => spawnSync("node", [script, ...args], { env: { ...process.env, ORION_MAC_BRIDGE: bin }, encoding: "utf8" });

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
  assert.equal(r.status, 1);
  assert.match(r.stderr, /will not quit/);
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
