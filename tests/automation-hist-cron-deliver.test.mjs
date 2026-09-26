import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = join(dirname(dirname(new URL(import.meta.url).pathname)), "scripts/orion-cron-deliver");

async function home(t, alertExit = 0) {
  const tmp = await mkdtemp(join(tmpdir(), "orion-hist-"));
  t.after(async () => rm(tmp, { recursive: true, force: true }));
  await mkdir(join(tmp, "Desktop/ORION/scripts"), { recursive: true });
  await writeFile(
    join(tmp, "Desktop/ORION/scripts/orion-discord-alert"),
    `#!/bin/sh\necho "$1" >> "$HOME/alerts.log"\nexit ${alertExit}\n`,
    { mode: 0o755 },
  );
  return tmp;
}

function run(tmp, args) {
  const result = spawnSync(process.execPath, [SCRIPT, "--label", "t", ...args], {
    env: { ...process.env, HOME: tmp },
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readHistory(tmp) {
  const path = join(tmp, ".openclaw/orion-controlled/cron-delivery-history.jsonl");
  const raw = readFile(path, "utf8").catch(() => "");
  return raw;
}

test("a silent command records silent and keeps its exit code", async (t) => {
  const tmp = await home(t);
  const r = run(tmp, ["--", "/bin/sh", "-c", "exit 4"]);
  assert.equal(r.status, 4);
  const raw = await readHistory(tmp);
  const lines = raw.trim().split("\n").filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.outcome, "silent");
});

test("output that does not match records no_match", async (t) => {
  const tmp = await home(t);
  const r = run(tmp, ["--match", "OFF", "--", "/bin/sh", "-c", "echo hello"]);
  assert.equal(r.status, 0);
  const raw = await readHistory(tmp);
  const lines = raw.trim().split("\n").filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.outcome, "no_match");
  // alerts.log should not exist
  await assert.rejects(readFile(join(tmp, "alerts.log"), "utf8"));
});

test("a delivered message records delivered", async (t) => {
  const tmp = await home(t);
  const r = run(tmp, ["--", "/bin/sh", "-c", "echo hi; exit 3"]);
  assert.equal(r.status, 3);
  const raw = await readHistory(tmp);
  const lines = raw.trim().split("\n").filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.outcome, "delivered");
  const alerts = await readFile(join(tmp, "alerts.log"), "utf8");
  assert.ok(alerts.includes("[t] hi"));
});

test("the same message again records duplicate", async (t) => {
  const tmp = await home(t);
  run(tmp, ["--", "/bin/sh", "-c", "echo hi"]);
  const r2 = run(tmp, ["--", "/bin/sh", "-c", "echo hi"]);
  assert.equal(r2.status, 0);
  const raw = await readHistory(tmp);
  const lines = raw.trim().split("\n").filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.outcome, "duplicate");
});

test("a different message inside the interval records held_back", async (t) => {
  const tmp = await home(t);
  run(tmp, ["--", "/bin/sh", "-c", "echo a"]);
  const r2 = run(tmp, ["--", "/bin/sh", "-c", "echo b"]);
  assert.equal(r2.status, 0);
  const raw = await readHistory(tmp);
  const lines = raw.trim().split("\n").filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.outcome, "held_back");
});

test("a failing alert records delivery_failed", async (t) => {
  const tmp = await home(t, 1);
  const r = run(tmp, ["--", "/bin/sh", "-c", "echo hi"]);
  assert.equal(r.status, 0);
  const raw = await readHistory(tmp);
  const lines = raw.trim().split("\n").filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.outcome, "delivery_failed");
});

test("a history line holds only v, at, label, outcome and exitCode", async (t) => {
  const tmp = await home(t);
  run(tmp, ["--", "/bin/sh", "-c", "echo hi"]);
  const raw = await readHistory(tmp);
  const lines = raw.trim().split("\n").filter(Boolean);
  const line = lines[lines.length - 1];
  const obj = JSON.parse(line);
  assert.deepEqual(Object.keys(obj).sort(), ["at", "exitCode", "label", "outcome", "v"]);
  assert.ok(!line.includes("hi"));
});

test("an unwritable history file does not change the exit code", async (t) => {
  const tmp = await home(t);
  // Make the history path itself a directory so appendFile fails
  const histPath = join(tmp, ".openclaw/orion-controlled/cron-delivery-history.jsonl");
  await mkdir(dirname(histPath), { recursive: true });
  await mkdir(histPath);
  const r = run(tmp, ["--", "/bin/sh", "-c", "echo hi; exit 5"]);
  assert.equal(r.status, 5);
  assert.ok(r.stderr.includes("could not record history"));
});
