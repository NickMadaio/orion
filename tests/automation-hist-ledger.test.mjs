import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendAutomationHistory,
  readAutomationHistory,
} from "../scripts/lib/orion-automation-history.mjs";

const validEntry = {
  at: 1000,
  name: "hist-test",
  status: "succeeded",
  reason: null,
  delivery: "not_requested",
};

test("appends one line per entry and reads them back in time order", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-hist-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "history.jsonl");

  await appendAutomationHistory(file, { ...validEntry, at: 3000 }, { now: () => 42 });
  await appendAutomationHistory(file, { ...validEntry, at: 1000 }, { now: () => 42 });
  await appendAutomationHistory(file, { ...validEntry, at: 2000 }, { now: () => 42 });

  const result = await readAutomationHistory(file);
  assert.equal(result.entries.length, 3);
  assert.deepEqual(result.entries.map((e) => e.at), [1000, 2000, 3000]);
  for (const entry of result.entries) {
    assert.equal(entry.recordedAt, 42);
    assert.equal(entry.v, 1);
  }
});

test("rejects invalid entries with a TypeError", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-hist-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "history.jsonl");

  const invalidCases = [
    null,
    { at: 1000, status: "succeeded", reason: null, delivery: "not_requested" }, // missing name
    { ...validEntry, name: "../x" },
    { ...validEntry, status: "done" },
    { ...validEntry, at: -1 },
    { ...validEntry, at: 1.5 },
    { ...validEntry, reason: "Quiet Hours" },
    { ...validEntry, delivery: "sent" },
    { ...validEntry, output: "extra" }, // extra key
  ];

  for (const entry of invalidCases) {
    await assert.rejects(
      appendAutomationHistory(file, entry),
      TypeError
    );
  }

  // File should not exist after all rejections
  try {
    await stat(file);
    assert.fail("File should not exist");
  } catch (err) {
    assert.equal(err.code, "ENOENT");
  }
});

test("never rewrites earlier lines", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-hist-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "history.jsonl");

  await appendAutomationHistory(file, validEntry);
  const firstBytes = await readFile(file);

  await appendAutomationHistory(file, { ...validEntry, at: 2000 });
  const secondBytes = await readFile(file);

  assert.ok(secondBytes.slice(0, firstBytes.length).equals(firstBytes));
});

test("missing file reads as empty", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-hist-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "nonexistent.jsonl");

  const result = await readAutomationHistory(file);
  assert.deepEqual(result, { entries: [], skipped: 0 });
});

test("corrupt and invalid lines are skipped and counted", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-hist-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "history.jsonl");

  const validLine1 = JSON.stringify({ ...validEntry, at: 1000, v: 1, recordedAt: 42 }) + "\n";
  const brokenJson = "{broken\n";
  const invalidStatus = JSON.stringify({ ...validEntry, at: 2000, status: "done", v: 1, recordedAt: 42 }) + "\n";
  const blankLine = "\n";
  const validLine2 = JSON.stringify({ ...validEntry, at: 3000, v: 1, recordedAt: 42 }) + "\n";

  await writeFile(file, validLine1 + brokenJson + invalidStatus + blankLine + validLine2);

  const result = await readAutomationHistory(file);
  assert.equal(result.entries.length, 2);
  assert.equal(result.skipped, 2);
});

test("window is half-open: since inclusive, until exclusive", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-hist-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "history.jsonl");

  await appendAutomationHistory(file, { ...validEntry, at: 1000 });
  await appendAutomationHistory(file, { ...validEntry, at: 2000 });
  await appendAutomationHistory(file, { ...validEntry, at: 3000 });

  const result = await readAutomationHistory(file, { since: 1000, until: 3000 });
  assert.deepEqual(result.entries.map((e) => e.at), [1000, 2000]);
});

test("creates the file 0600 and its directory 0700", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-hist-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "history", "x.jsonl");

  await appendAutomationHistory(file, validEntry);

  const fileStat = await stat(file);
  assert.equal(fileStat.mode & 0o777, 0o600);

  const dirStat = await stat(join(root, "history"));
  assert.equal(dirStat.mode & 0o777, 0o700);
});
