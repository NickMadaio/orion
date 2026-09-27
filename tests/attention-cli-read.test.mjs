import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { strict as assert } from "node:assert";
import { saveAttentionQueue, emptyQueue } from "../scripts/lib/attention/store.mjs";

const SCRIPT = join(dirname(new URL(import.meta.url).pathname), "..", "scripts", "orion-attention");

function runCli(tmp, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: tmp },
  });
}

const now = 1790000000000;

await import("node:test");
import test from "node:test";

test("list prints open items by score", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
  t.after(async () => rm(tmp, { recursive: true, force: true }));

  const queueFile = join(tmp, "attention.json");
  const queue = emptyQueue();
  queue.items.push({
    id: "cal:aaa",
    source: "calendar",
    kind: "starting_soon",
    title: "High priority meeting",
    detail: "",
    observedAt: now,
    dueAt: now + 3600000,
    expiresAt: null,
    dedupKey: "cal:aaa",
    signals: { urgency: 0.9, actionability: 0.8, novelty: null, confidence: 0.9, importance: 0.7, interruptibility: null },
    state: "open",
    surfaced: 0,
    ackedAt: null,
    snoozedUntil: null,
  });
  queue.items.push({
    id: "cal:bbb",
    source: "calendar",
    kind: "starting_soon",
    title: "Low priority meeting",
    detail: "",
    observedAt: now,
    dueAt: now + 7200000,
    expiresAt: null,
    dedupKey: "cal:bbb",
    signals: { urgency: 0.3, actionability: 0.4, novelty: null, confidence: 0.5, importance: 0.3, interruptibility: null },
    state: "open",
    surfaced: 0,
    ackedAt: null,
    snoozedUntil: null,
  });
  await saveAttentionQueue(queueFile, queue);

  const result = runCli(tmp, ["list", "--file", queueFile]);
  assert.strictEqual(result.status, 0);
  const stdout = result.stdout;
  // High priority should appear first (higher score)
  const lines = stdout.trim().split("\n");
  assert.ok(lines[0].includes("High priority meeting"), `first line should contain high priority: ${lines[0]}`);
  assert.ok(lines[1].includes("Low priority meeting"), `second line should contain low priority: ${lines[1]}`);
});

test("list --json is machine-readable", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
  t.after(async () => rm(tmp, { recursive: true, force: true }));

  const queueFile = join(tmp, "attention.json");
  const queue = emptyQueue();
  queue.items.push({
    id: "cal:json1",
    source: "calendar",
    kind: "starting_soon",
    title: "JSON test item",
    detail: "",
    observedAt: now,
    dueAt: null,
    expiresAt: null,
    dedupKey: "cal:json1",
    signals: { urgency: 0.5, actionability: 0.6, novelty: null, confidence: 0.7, importance: 0.4, interruptibility: null },
    state: "open",
    surfaced: 0,
    ackedAt: null,
    snoozedUntil: null,
  });
  await saveAttentionQueue(queueFile, queue);

  const result = runCli(tmp, ["list", "--json", "--file", queueFile]);
  assert.strictEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.ok(Array.isArray(parsed));
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].id, "cal:json1");
  assert.ok(typeof parsed[0].score === "number" || parsed[0].score === null);
});

test("a missing queue is simply empty", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
  t.after(async () => rm(tmp, { recursive: true, force: true }));

  const result = runCli(tmp, ["list"]);
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("No attention items."));
});

test("show prints one entry and refuses unknown ids", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
  t.after(async () => rm(tmp, { recursive: true, force: true }));

  const queueFile = join(tmp, "attention.json");
  const queue = emptyQueue();
  queue.items.push({
    id: "show:test",
    source: "manual",
    kind: "test",
    title: "Show test",
    detail: "",
    observedAt: now,
    dueAt: null,
    expiresAt: null,
    dedupKey: "show:test",
    signals: { urgency: 0.5, actionability: 0.5, novelty: null, confidence: 0.5, importance: 0.5, interruptibility: null },
    state: "open",
    surfaced: 0,
    ackedAt: null,
    snoozedUntil: null,
  });
  await saveAttentionQueue(queueFile, queue);

  // Show existing item
  const result1 = runCli(tmp, ["show", "show:test", "--file", queueFile]);
  assert.strictEqual(result1.status, 0);
  const parsed = JSON.parse(result1.stdout);
  assert.strictEqual(parsed.id, "show:test");

  // Show unknown id
  const result2 = runCli(tmp, ["show", "nonexistent:id", "--file", queueFile]);
  assert.ok(result2.status === 1 || result2.status === 2);
  assert.ok(result2.stderr.includes("no attention item nonexistent:id"));
});

test("an unknown command is refused", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
  t.after(async () => rm(tmp, { recursive: true, force: true }));

  const result = runCli(tmp, ["bogus"]);
  assert.ok(result.status === 1 || result.status === 2);
  assert.ok(result.stderr.length > 0);
});
