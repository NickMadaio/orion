import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { initializeAutomationAdmission as initialize, reserveAutomationRun as reserve } from "../scripts/lib/orion-automation-admission.mjs";

const execute = promisify(execFile);
const moduleURL = new URL("../scripts/lib/orion-automation-admission.mjs", import.meta.url).href;
const record = () => ({ name: "daily-brief", installationId: "installation-0001",
  timeZone: "Europe/London", expiresOn: "2026-12-31", conditions: {},
  permissions: { expectsMode: "guarded" }, riskLimits: { maxRunsPerDay: 1 } });
const context = instant => ({ now: Date.parse(instant), effectiveMode: "guarded", focusActive: false });
async function fixture(t, policy = record()) {
  const root = await mkdtemp(join(tmpdir(), "orion-admission-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initialize(root, policy);
  return root;
}
async function child(root, policy, current) {
  const source = `import {reserveAutomationRun} from ${JSON.stringify(moduleURL)};
    console.log(JSON.stringify(await reserveAutomationRun(...JSON.parse(process.argv[1]))));`;
  const result = await execute(process.execPath, ["--input-type=module", "-e", source,
    JSON.stringify([root, policy, current])]);
  return JSON.parse(result.stdout);
}
test("expiry is inclusive in the installation timezone, not UTC", async t => {
  const p = record(); p.expiresOn = "2026-09-18";
  const root = await fixture(t, p);
  assert.equal((await reserve(root, p, context("2026-09-18T22:59:59Z"))).admitted, true);
  assert.equal((await reserve(root, p, context("2026-09-18T23:00:00Z"))).reason, "expired");
});
test("invalid leap date and implicit timezone refuse initialization", async t => {
  const root = await fixture(t);
  for (const change of [{ expiresOn: "2026-02-29" }, { expiresOn: "2026-04-31" },
    { timeZone: undefined }, { timeZone: "EST" }, { name: undefined }, { name: 12345 }]) {
    await assert.rejects(initialize(root, { ...record(), ...change }));
  }
});
test("cross-midnight quiet hours suppress; equal endpoints are empty", async t => {
  const p = record(); p.conditions.quietHours = [22, 7];
  const root = await fixture(t, p);
  for (const instant of ["2026-09-18T21:00:00Z", "2026-09-19T05:59:00Z"]) {
    assert.equal((await reserve(root, p, context(instant))).reason, "quiet_hours");
  }
  assert.equal((await reserve(root, p, context("2026-09-19T06:00:00Z"))).admitted, true);
  const equal = record(); equal.conditions.quietHours = [7, 7];
  const second = await fixture(t, equal);
  assert.equal((await reserve(second, equal, context("2026-09-19T06:00:00Z"))).admitted, true);
});
test("required focus observation must be explicitly false", async t => {
  const p = record(); p.conditions.skipDuringFocus = true;
  const root = await fixture(t, p); const c = context("2026-09-18T12:00Z");
  for (const focusActive of [undefined, null, "false", true]) {
    assert.equal((await reserve(root, p, { ...c, focusActive })).admitted, false);
  }
  assert.equal((await reserve(root, p, c)).admitted, true);
});
test("effective strictness mismatch or unknown mode cannot consume a run", async t => {
  const p = record(), root = await fixture(t, p), c = context("2026-09-18T12:00Z");
  for (const effectiveMode of [undefined, "sovereign", "invalid"]) {
    assert.equal((await reserve(root, p, { ...c, effectiveMode })).reason, "mode_mismatch");
  }
  assert.equal((await reserve(root, p, c)).runNumber, 1);
});
test("separate processes compete for the final daily slot", async t => {
  const p = record(), root = await fixture(t, p), c = context("2026-09-18T12:00Z");
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => child(root, p, c)));
  assert.equal(outcomes.filter(result => result.admitted).length, 1);
  assert.ok(outcomes.filter(result => !result.admitted).every(result => ["busy", "daily_limit"].includes(result.reason)));
});
test("reservation remains charged when process exits without executing anything", async t => {
  const p = record(), root = await fixture(t, p), c = context("2026-09-18T12:00Z");
  assert.equal((await child(root, p, c)).admitted, true);
  assert.equal((await child(root, p, c)).reason, "daily_limit");
  await assert.rejects(initialize(root, p), { code: "EEXIST" });
});
test("DST short and long days reset on civil midnight only", async t => {
  for (const [first, sameDay, midnight] of [
    ["2026-03-29T00:00Z", "2026-03-29T22:59Z", "2026-03-29T23:00Z"],
    ["2026-10-25T00:30Z", "2026-10-25T01:30Z", "2026-10-26T00:00Z"],
  ]) {
    const p = record(), root = await fixture(t, p);
    assert.equal((await reserve(root, p, context(first))).admitted, true);
    assert.equal((await reserve(root, p, context(sameDay))).reason, "daily_limit");
    assert.equal((await reserve(root, p, context(midnight))).admitted, true);
  }
});
test("backward clock cannot replenish an earlier day", async t => {
  const p = record(), root = await fixture(t, p);
  assert.equal((await reserve(root, p, context("+010000-01-01T00:00:00Z"))).reason, "invalid_clock");
  await reserve(root, p, context("2026-09-18T12:00Z"));
  await reserve(root, p, context("2026-09-19T12:00Z"));
  assert.equal((await reserve(root, p, context("2026-09-18T13:00Z"))).reason, "clock_regressed");
});
test("policy or timezone changes cannot reuse state to reset counters", async t => {
  const p = record(), root = await fixture(t, p), c = context("2026-09-18T12:00Z");
  await reserve(root, p, c);
  for (const change of [{ timeZone: "UTC" }, { name: "new-name" }, { riskLimits: { maxRunsPerDay: 2 } }]) {
    assert.equal((await reserve(root, { ...p, ...change }, c)).reason, "invalid_state");
  }
});
test("missing or corrupt runtime state is never silently recreated", async t => {
  const p = record(), root = await fixture(t, p), c = context("2026-09-18T12:00Z");
  const state = join(root, (await readdir(root))[0]);
  await writeFile(state, '{broken');
  assert.equal((await reserve(root, p, c)).admitted, false);
  await rm(state);
  assert.equal((await reserve(root, p, c)).admitted, false);
  assert.deepEqual(await readdir(root), []);
});
test("abandoned lock refuses and is not removed automatically", async t => {
  const p = record(), root = await fixture(t, p), c = context("2026-09-18T12:00Z");
  const state = (await readdir(root))[0], before = await readFile(join(root, state), "utf8");
  await mkdir(join(root, state.replace(/\.json$/, ".lock")));
  assert.equal((await reserve(root, p, c)).reason, "busy");
  assert.equal(await readFile(join(root, state), "utf8"), before);
});
test("inconsistent stored day or zero count cannot replenish quota", async t => {
  const p = record(), root = await fixture(t, p), c = context("2026-09-18T12:00Z");
  await reserve(root, p, c);
  const file = join(root, (await readdir(root))[0]);
  const original = JSON.parse(await readFile(file, "utf8"));
  for (const change of [{ day: "2026-09-17" }, { runs: 0 }]) {
    await writeFile(file, JSON.stringify({ ...original, ...change }));
    assert.equal((await reserve(root, p, c)).reason, "invalid_state");
  }
});
async function faultChild(root, policy, current, fault) {
  // Isolate builtin fault injection in a child; run the actual module unchanged.
  const source = `import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const [root, policy, current, fault] = JSON.parse(process.argv[1]);
    const originalOpen = fs.open, originalRename = fs.rename;
    fs.open = async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]).endsWith('.tmp')) {
        if (fault === 'write') handle.writeFile = async () => {throw new Error('injected write');};
        if (fault === 'file_sync') handle.sync = async () => {throw new Error('injected sync');};
      }
      if (args[0] === root && fault === 'directory_sync') {
        handle.sync = async () => {throw new Error('injected directory sync');};
      }
      return handle;
    };
    fs.rename = async (...args) => {
      if (fault === 'rename') throw new Error('injected rename');
      if (fault === 'crash_before_rename') process.exit(73);
      await originalRename(...args);
      if (fault === 'crash_after_rename') process.exit(73);
    };
    syncBuiltinESMExports();
    const {reserveAutomationRun} = await import(${JSON.stringify(moduleURL)});
    console.log(JSON.stringify(await reserveAutomationRun(root, policy, current)));`;
  return execute(process.execPath, ["--input-type=module", "-e", source,
    JSON.stringify([root, policy, current, fault])]);
}
test("write, file sync, rename and directory sync failure never admit", async t => {
  for (const fault of ["write", "file_sync", "rename", "directory_sync"]) {
    const p = record(), root = await fixture(t, p), c = context("2026-09-18T12:00Z");
    const result = JSON.parse((await faultChild(root, p, c, fault)).stdout);
    assert.equal(result.admitted, false, fault);
    assert.ok((await readdir(root)).every(name => !name.endsWith('.tmp') && !name.endsWith('.lock')));
    if (fault === "directory_sync") {
      // Replacement already occurred: uncertain persistence consumes the slot.
      assert.equal((await reserve(root, p, c)).reason, "daily_limit");
    }
  }
});
test("process death around publication leaves a lock and never reports admission", async t => {
  for (const fault of ["crash_before_rename", "crash_after_rename"]) {
    const p = record(), root = await fixture(t, p), c = context("2026-09-18T12:00Z");
    await assert.rejects(faultChild(root, p, c, fault), error => error.code === 73 && error.stdout === "");
    assert.equal((await reserve(root, p, c)).reason, "busy");
    if (fault === "crash_after_rename") {
      // Fixture-only operator recovery, after positively observing child exit.
      const lock = (await readdir(root)).find(name => name.endsWith('.lock'));
      await rm(join(root, lock), { recursive: true });
      assert.equal((await reserve(root, p, c)).reason, "daily_limit");
    }
  }
});
