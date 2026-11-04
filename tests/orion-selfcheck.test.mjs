import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { writeFixtureDir } from "./selfcheck-fixture.mjs";

const BIN = join(import.meta.dirname, "..", "scripts", "orion-selfcheck");
const NOW = "2026-11-04T23:00:00Z";
const run = (dir, args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_NOW: NOW, TZ: "UTC" } });
const fresh = () => { const dir = mkdtempSync(join(tmpdir(), "selfcheck-cli-")); const f = writeFixtureDir(dir); return { dir, ...f }; };

test("last --json summarises the recent turns with routes and tools, and no secrets", () => {
  const { dir, secret } = fresh();
  const r = run(dir, ["last", "--n", "3", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.turns.length, 3);
  assert.equal(out.turns.find((t) => t.message === "open amazon uk").tools[0].action, "app_open");
  assert.equal(r.stdout.includes(secret), false);
});

test("last prints a readable summary", () => {
  const { dir } = fresh();
  const r = run(dir, ["last", "--n", "2"]);
  assert.match(r.stdout, /you: no amazon is a website/);
  assert.match(r.stdout, /route: ask/);
});

test("why finds the turn he means and returns a first-person diagnosis", () => {
  const { dir } = fresh();
  const r = run(dir, ["why", "--about", "why didnt you open amazon", "--exclude", "why didnt you open amazon", "--json"]);
  const out = JSON.parse(r.stdout);
  assert.equal(out.diagnosis.kind, "wrong-tool");
  assert.match(out.diagnosis.says, /routing mistake on my side/);
});

test("why with nothing recorded says so instead of inventing a cause", () => {
  const dir = mkdtempSync(join(tmpdir(), "selfcheck-none-"));
  const out = JSON.parse(run(dir, ["why", "--json"]).stdout);
  assert.equal(out.ok, true);
  assert.equal(out.diagnosis, null);
});

test("scan lists the failures of one day", () => {
  const { dir, day } = fresh();
  const out = JSON.parse(run(dir, ["scan", "--day", day, "--json"]).stdout);
  assert.equal(out.day, day);
  assert.equal(out.failures.some((f) => f.signature === "wrong-tool:app_open"), true);
  const other = JSON.parse(run(dir, ["scan", "--day", "2026-10-01", "--json"]).stdout);
  assert.equal(other.failures.length, 0);
});

test("it never writes: bad usage is exit 2", () => {
  const { dir } = fresh();
  assert.equal(run(dir, ["frobnicate"]).status, 2);
});

test("why --request: a turn with no clear fault still becomes a fixable 'requested' diagnosis (he asked for the fix)", () => {
  const { dir } = fresh();
  const plain = JSON.parse(run(dir, ["why", "--about", "whats on my plan", "--exclude", "fix your code", "--json"]).stdout);
  assert.equal(plain.diagnosis.fixable, false);
  const r = JSON.parse(run(dir, ["why", "--about", "whats on my plan", "--exclude", "fix your code", "--request", "--json"]).stdout);
  assert.equal(r.diagnosis.kind, "requested");
  assert.equal(r.diagnosis.fixable, true);
  assert.match(r.diagnosis.says, /You asked me to fix this/);
  assert.equal(r.diagnosis.failingExample.message, "whats on my plan");
  assert.ok(r.diagnosis.files.length > 0);
});

test("why --request keeps a real diagnosis as it is", () => {
  const { dir } = fresh();
  const r = JSON.parse(run(dir, ["why", "--about", "open amazon", "--request", "--json"]).stdout);
  assert.equal(r.diagnosis.kind, "wrong-tool");
});
