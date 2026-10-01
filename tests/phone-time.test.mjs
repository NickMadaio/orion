import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/orion-phone-time", import.meta.url));
const NOW = "2026-10-01T00:25:00+01:00";
function world(t, screen) {
  const dir = mkdtempSync(join(tmpdir(), "orion-phone-time-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (screen) writeFileSync(join(dir, "health-log.json"), JSON.stringify({ phoneScreen: screen }));
  const run = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8",
    env: { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_NOW: NOW, TZ: "Europe/London" } }); return { code: r.status, out: r.stdout + r.stderr }; };
  return { dir, run };
}

test("status says locked, until when and why (the 00:24 message, 2026-10-01)", (t) => {
  const { run } = world(t, { at: "2026-09-30T23:20:00Z", locked: true, until: "2026-10-01T06:15:00Z", why: "night" });
  const r = run("status");
  assert.match(r.out, /^LOCKED: .* until 7:15 AM \(past bedtime\)/);
});

test("status is honest when the phone has not reported", (t) => {
  assert.match(world(t).run("status").out, /^Unknown/);
});

test("a grant until 12:45 is written for the phone link and says when it re-locks", (t) => {
  const { dir, run } = world(t, { at: "2026-09-30T23:20:00Z", locked: true, until: "2026-10-01T06:15:00Z", why: "night" });
  const r = run("grant", "00:45", "--because", "asked for 20 more minutes");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /until 12:45 AM \(20 min\)/);
  const grant = JSON.parse(readFileSync(join(dir, "screen-grant.json"), "utf8"));
  assert.equal(new Date(grant.until).toISOString(), "2026-09-30T23:45:00.000Z");
  assert.ok(grant.id);
});

test("more than an hour is refused, and a reason is required", (t) => {
  const { dir, run } = world(t);
  assert.equal(run("grant", "90", "--because", "please").code, 1);
  assert.equal(run("grant", "20").code, 2);
  assert.equal(existsSync(join(dir, "screen-grant.json")), false);
});

test("revoke removes the grant", (t) => {
  const { dir, run } = world(t);
  run("grant", "20", "--because", "x");
  assert.equal(run("revoke").code, 0);
  assert.equal(existsSync(join(dir, "screen-grant.json")), false);
});

test("a grant to a phone that has never reported is sent, not claimed as done (2026-10-01)", (t) => {
  const { run } = world(t);
  const r = run("grant", "20", "--because", "text friends then bed");
  assert.equal(r.code, 0);
  assert.match(r.out, /^SENT, NOT CONFIRMED/);
  assert.match(r.out, /Do not say he is unlocked/);
});
