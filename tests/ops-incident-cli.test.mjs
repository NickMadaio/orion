// tests/ops-incident-cli.test.mjs
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { strict as assert } from "node:assert";
import { test } from "node:test";

const SCRIPT = join(dirname(new URL(import.meta.url).pathname), "..", "scripts", "orion-incident-timeline");

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: env.HOME },
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

function writeJsonl(dir, name, records) {
  const lines = records.map((r) => JSON.stringify(r));
  return writeFile(join(dir, name), lines.join("\n") + "\n");
}

test("the logs in a directory print as one timeline", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
  t.after(async () => rm(tmp, { recursive: true, force: true }));

  const now = Date.now();
  const sinceMs = now - 3 * 24 * 60 * 60 * 1000; // 3 days ago

  await writeJsonl(tmp, "permission-audit.jsonl", [
    { changedAt: now - 86400000, previous: { profile: "user" }, next: { profile: "admin" } },
  ]);
  await writeJsonl(tmp, "remote-audit.jsonl", [
    { at: now - 50000000, decision: "allowed", verb: "read", text: "file.txt" },
  ]);
  await writeJsonl(tmp, "repair-audit.jsonl", [
    { at: now - 10000000, kind: "patch", surface: "api", target: "v1", outcome: "ok" },
  ]);
  await writeJsonl(tmp, "location-audit.jsonl", [
    { at: now - 20000000, action: "moved" },
  ]);

  const result = run(["--dir", tmp, "--since", new Date(sinceMs).toISOString()]);
  assert.strictEqual(result.status, 0);
  const lines = result.stdout.trim().split("\n");
  // Should have 4 events (one from each log)
  assert.ok(lines.length >= 4, `expected at least 4 lines, got ${lines.length}: ${result.stdout}`);
  // Check that all four sources appear
  // Format: <iso(24)>  <severity(6)> <source(10)> <summary>
  // ISO is 24 chars (e.g. 2025-06-18T12:00:00.000Z), then 2 spaces, severity 6 chars, 1 space, source 10 chars
  // source starts at index 24 + 2 + 6 + 1 = 33, length 10
  const sources = lines.map((l) => l.slice(33, 43).trim()).filter(Boolean);
  assert.ok(sources.some((s) => s === "permission"), `missing permission source, got: ${sources}`);
  assert.ok(sources.some((s) => s === "remote"), `missing remote source, got: ${sources}`);
  assert.ok(sources.some((s) => s === "repair"), `missing repair source, got: ${sources}`);
  assert.ok(sources.some((s) => s === "location"), `missing location source, got: ${sources}`);
});

test("--severity high keeps only high events", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
  t.after(async () => rm(tmp, { recursive: true, force: true }));

  const now = Date.now();
  const sinceMs = now - 3 * 24 * 60 * 60 * 1000;

  // Permission and repair are high; remote (allowed) is low; location is low
  await writeJsonl(tmp, "permission-audit.jsonl", [
    { changedAt: now - 86400000, previous: { profile: "user" }, next: { profile: "admin" } },
  ]);
  await writeJsonl(tmp, "remote-audit.jsonl", [
    { at: now - 50000000, decision: "allowed", verb: "read", text: "file.txt" },
  ]);
  await writeJsonl(tmp, "repair-audit.jsonl", [
    { at: now - 10000000, kind: "patch", surface: "api", target: "v1", outcome: "ok" },
  ]);
  await writeJsonl(tmp, "location-audit.jsonl", [
    { at: now - 20000000, action: "moved" },
  ]);

  const result = run(["--dir", tmp, "--since", new Date(sinceMs).toISOString(), "--severity", "high"]);
  assert.strictEqual(result.status, 0);
  const lines = result.stdout.trim().split("\n");
  // Only permission (high) and repair (high) should remain — 2 events
  assert.ok(lines.length === 2, `expected 2 high-severity lines, got ${lines.length}: ${result.stdout}`);
});

test("missing files and bad lines do not fail", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
  t.after(async () => rm(tmp, { recursive: true, force: true }));

  const now = Date.now();
  const sinceMs = now - 3 * 24 * 60 * 60 * 1000;

  // Only write one file; the other three are missing
  await writeFile(join(tmp, "permission-audit.jsonl"), `{"changedAt": ${now}, "previous": {"profile": "a"}, "next": {"profile": "b"}}\nnot-json\n`);

  const result = run(["--dir", tmp, "--since", new Date(sinceMs).toISOString()]);
  assert.strictEqual(result.status, 0);
  // Should have the valid permission event plus a skipped line notice
  assert.ok(result.stdout.includes("unreadable"), `expected skip notice, got: ${result.stdout}`);
});

test("bad flags are refused", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
  t.after(async () => rm(tmp, { recursive: true, force: true }));

  // Bad severity
  let result = run(["--dir", tmp, "--severity", "extreme"]);
  assert.strictEqual(result.status, 2, `expected exit 2 for bad severity, got ${result.status}`);

  // Bad since
  result = run(["--dir", tmp, "--since", "not-a-date"]);
  assert.strictEqual(result.status, 2, `expected exit 2 for bad since, got ${result.status}`);
});

