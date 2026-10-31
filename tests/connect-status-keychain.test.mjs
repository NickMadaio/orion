// REV3 11 (2026-10-31): `orion-connect status` only needs to know whether a key EXISTS. It used to read every value with
// `security find-generic-password -w`, which puts the secret in memory and can raise a Keychain prompt per item.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const CLI = new URL("../scripts/orion-connect", import.meta.url).pathname;

function fakeSecurity(exitCode) {
  const bin = mkdtempSync(join(tmpdir(), "fake-security-"));
  const log = join(bin, "calls.log");
  writeFileSync(join(bin, "security"), `#!/bin/sh\necho "$*" >> "${log}"\nfor a in "$@"; do [ "$a" = "-w" ] && echo "sk-LEAKED-VALUE"; done\nexit ${exitCode}\n`);
  chmodSync(join(bin, "security"), 0o755);
  return { bin, log };
}

function status(fake) {
  const dir = mkdtempSync(join(tmpdir(), "connect-status-"));
  const r = spawnSync(process.execPath, [CLI, "status"], { encoding: "utf8", env: { ...process.env, PATH: `${fake.bin}:${process.env.PATH}`, ORION_CONNECTORS_DIR: dir } });
  rmSync(dir, { recursive: true, force: true });
  return r;
}

test("status asks the Keychain whether a key exists, never for its value (-w)", () => {
  const fake = fakeSecurity(0);
  try {
    const r = status(fake);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(fake.log), "status never asked the Keychain at all");
    const calls = readFileSync(fake.log, "utf8").trim().split("\n");
    assert.ok(calls.length > 0);
    for (const call of calls) {
      assert.match(call, /^find-generic-password /);
      assert.doesNotMatch(call, /(^|\s)-w(\s|$)/, `status passed -w: ${call}`);
    }
    assert.doesNotMatch(r.stdout, /LEAKED/);
    const canvas = JSON.parse(r.stdout.trim().split("\n").at(-1)).find((row) => row.name === "canvas");
    assert.deepEqual(canvas, { name: "canvas", title: canvas.title, needsKey: true, keySet: true });
  } finally { rmSync(fake.bin, { recursive: true, force: true }); }
});

test("a key that is not in the Keychain reads as not set", () => {
  const fake = fakeSecurity(44);
  try {
    const r = status(fake);
    assert.equal(r.status, 0, r.stderr);
    const canvas = JSON.parse(r.stdout.trim().split("\n").at(-1)).find((row) => row.name === "canvas");
    assert.equal(canvas.keySet, false);
  } finally { rmSync(fake.bin, { recursive: true, force: true }); }
});
