import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyQueue,
  loadAttentionQueue,
  saveAttentionQueue,
  addToQueue,
  ackQueueItem,
  snoozeQueueItem,
  pruneQueue,
  openItems,
} from "../scripts/lib/attention/store.mjs";

describe("attention store", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
  after(async () => rm(tmp, { recursive: true, force: true }));

  it("a missing file loads as an empty queue", async () => {
    const q = await loadAttentionQueue(join(tmp, "no-such-file.json"));
    assert.deepEqual(q, { version: 1, items: [] });
  });

  it("save then load round-trips and the file is private", async () => {
    const file = join(tmp, "queue.json");
    const queue = { version: 1, items: [{ id: "a", state: "open" }] };
    await saveAttentionQueue(file, queue);

    const loaded = await loadAttentionQueue(file);
    assert.deepEqual(loaded, queue);

    const stats = await import("node:fs/promises").then((m) => m.stat(file));
    assert.strictEqual(stats.mode & 0o777, 0o600);
  });

  it("corrupt content is refused", async () => {
    const file = join(tmp, "bad.json");
    await writeFile(file, "{");
    await assert.rejects(
      loadAttentionQueue(file),
      /attention queue unreadable/
    );
  });

  it("adding the same dedupKey replaces the open entry and keeps surfaced", () => {
    const now = 1_700_000_000_000;
    let q = emptyQueue();

    const item1 = {
      id: "x1",
      source: "manual",
      kind: "test",
      title: "first",
      detail: "",
      observedAt: now,
      dueAt: null,
      expiresAt: null,
      dedupKey: "dup",
      signals: { urgency: 0.5, actionability: 0.5, novelty: null, confidence: 0.5, importance: null, interruptibility: null },
    };

    q = addToQueue(q, [item1], now);
    assert.strictEqual(q.items.length, 1);
    assert.strictEqual(q.items[0].title, "first");
    assert.strictEqual(q.items[0].surfaced, 0);

    // Simulate surfaced being incremented to 2
    q = { ...q, items: [{ ...q.items[0], surfaced: 2 }] };

    const item2 = { ...item1, title: "second" };
    q = addToQueue(q, [item2], now);

    assert.strictEqual(q.items.length, 1);
    assert.strictEqual(q.items[0].title, "second");
    assert.strictEqual(q.items[0].surfaced, 2);
  });

  it("ack, snooze and open items", () => {
    const now = 1_700_000_000_000;
    let q = emptyQueue();

    const itemA = {
      id: "a",
      source: "manual",
      kind: "test",
      title: "A",
      detail: "",
      observedAt: now,
      dueAt: null,
      expiresAt: null,
      dedupKey: "a",
      signals: { urgency: 0.5, actionability: 0.5, novelty: null, confidence: 0.5, importance: null, interruptibility: null },
    };

    const itemB = {
      id: "b",
      source: "manual",
      kind: "test",
      title: "B",
      detail: "",
      observedAt: now,
      dueAt: null,
      expiresAt: null,
      dedupKey: "b",
      signals: { urgency: 0.5, actionability: 0.5, novelty: null, confidence: 0.5, importance: null, interruptibility: null },
    };

    q = addToQueue(q, [itemA, itemB], now);

    // Ack A
    q = ackQueueItem(q, "a", now);
    assert.strictEqual(q.items.find((e) => e.id === "a").state, "acked");

    // Snooze B until now+1000
    q = snoozeQueueItem(q, "b", now + 1000);
    assert.strictEqual(q.items.find((e) => e.id === "b").state, "snoozed");

    // At now: openItems excludes both (A is acked, B is snoozed until later)
    let opens = openItems(q, now);
    assert.strictEqual(opens.length, 0);

    // At now+1000: B's snooze has expired, so it reappears
    opens = openItems(q, now + 1000);
    assert.strictEqual(opens.length, 1);
    assert.strictEqual(opens[0].id, "b");
  });

  it("prune drops expired and old acknowledged entries", () => {
    const now = 1_700_000_000_000;
    let q = emptyQueue();

    // Item that expires at now-1 (should be pruned)
    const expired = {
      id: "exp",
      source: "manual",
      kind: "test",
      title: "expired",
      detail: "",
      observedAt: now - 100,
      dueAt: null,
      expiresAt: now - 1,
      dedupKey: "exp",
      signals: { urgency: 0.5, actionability: 0.5, novelty: null, confidence: 0.5, importance: null, interruptibility: null },
    };

    // Item acked more than 7 days ago (should be pruned)
    const oldAcked = {
      id: "old",
      source: "manual",
      kind: "test",
      title: "old acked",
      detail: "",
      observedAt: now - 100,
      dueAt: null,
      expiresAt: null,
      dedupKey: "old",
      signals: { urgency: 0.5, actionability: 0.5, novelty: null, confidence: 0.5, importance: null, interruptibility: null },
    };

    // Item that is still valid (should survive)
    const alive = {
      id: "alive",
      source: "manual",
      kind: "test",
      title: "alive",
      detail: "",
      observedAt: now,
      dueAt: null,
      expiresAt: null,
      dedupKey: "alive",
      signals: { urgency: 0.5, actionability: 0.5, novelty: null, confidence: 0.5, importance: null, interruptibility: null },
    };

    q = addToQueue(q, [expired, oldAcked, alive], now);

    // Ack the old item with a timestamp >7 days ago
    q = ackQueueItem(q, "old", now - 8 * 86_400_000);

    q = pruneQueue(q, now);
    assert.strictEqual(q.items.length, 1);
    assert.strictEqual(q.items[0].id, "alive");
  });

  it("unknown ids throw", () => {
    const q = emptyQueue();
    assert.throws(() => ackQueueItem(q, "nope", 0), /no attention item nope/);
    assert.throws(() => snoozeQueueItem(q, "nope", 0), /no attention item nope/);
  });

  it("operations never mutate the queue they are given", () => {
    const now = 1_700_000_000_000;
    const q = emptyQueue();

    const item = {
      id: "mut",
      source: "manual",
      kind: "test",
      title: "mutate test",
      detail: "",
      observedAt: now,
      dueAt: null,
      expiresAt: null,
      dedupKey: "mut",
      signals: { urgency: 0.5, actionability: 0.5, novelty: null, confidence: 0.5, importance: null, interruptibility: null },
    };

    const input = addToQueue(q, [item], now);
    Object.freeze(input.items[0]);
    Object.freeze(input);

    // addToQueue should not mutate
    const item2 = { ...item, title: "updated" };
    const result1 = addToQueue(input, [item2], now);
    assert.strictEqual(input.items[0].title, "mutate test");
    assert.strictEqual(result1.items[0].title, "updated");

    // ack should not mutate
    const result2 = ackQueueItem(result1, "mut", now);
    assert.strictEqual(result1.items[0].state, "open");
    assert.strictEqual(result2.items[0].state, "acked");

    // snooze should not mutate
    const result3 = snoozeQueueItem(result2, "mut", now + 500);
    assert.strictEqual(result2.items[0].state, "acked");
    assert.strictEqual(result3.items[0].state, "snoozed");

    // prune should not mutate
    const result4 = pruneQueue(result3, now);
    assert.strictEqual(result3.items.length, 1);
    assert.strictEqual(result4.items.length, 1);

    // openItems should not mutate (returns new array)
    const opens = openItems(result3, now + 600);
    assert.ok(opens !== result3.items);
  });
});
