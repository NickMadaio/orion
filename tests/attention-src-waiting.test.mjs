import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fromWaitingStore } from "../scripts/lib/attention/sources/waiting.mjs";

const NOW = Date.parse("2025-06-15T12:00:00Z");

function makeItem(overrides = {}) {
  return {
    id: "test-item",
    what: "A reply to my email",
    who: "prof@university.edu",
    expect: "a reply from prof@university.edu on the thesis extension",
    since: "2025-06-01",
    dueBy: "2025-06-14",
    status: "open",
    surfaced: 0,
    ...overrides,
  };
}

test("an overdue entry becomes an overdue item", () => {
  const store = {
    version: 1,
    items: [makeItem({ dueBy: "2025-06-14" })],
  };

  const items = fromWaitingStore(store, { now: NOW });

  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item.id, "waiting:test-item");
  assert.equal(item.source, "waiting");
  assert.equal(item.kind, "overdue");
  assert.equal(item.title, "Still waiting on prof@university.edu: A reply to my email");
  assert.equal(item.detail, "Ends when: a reply from prof@university.edu on the thesis extension");
  assert.equal(item.observedAt, NOW);
  assert.equal(item.dueAt, Date.parse("2025-06-14T23:59:59Z"));
  assert.equal(item.expiresAt, null);
  assert.equal(item.dedupKey, "waiting:test-item");
  assert.equal(item.signals.urgency, 0.85);
  assert.equal(item.signals.actionability, 0.8);
  assert.equal(item.signals.confidence, 0.8);
  assert.equal(item.signals.novelty, null);
  assert.equal(item.signals.importance, null);
  assert.equal(item.signals.interruptibility, 0.5);
});

test("due today is a gentler item", () => {
  const store = {
    version: 1,
    items: [makeItem({ dueBy: "2025-06-15" })],
  };

  const items = fromWaitingStore(store, { now: NOW });

  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item.kind, "due_today");
  assert.equal(item.title, "Due today from prof@university.edu: A reply to my email");
  assert.equal(item.signals.urgency, 0.6);
  assert.equal(item.signals.interruptibility, 0.5);
});

test("resolved, dismissed, snoozed and future entries are skipped", () => {
  const store = {
    version: 1,
    items: [
      makeItem({ id: "resolved-item", status: "resolved" }),
      makeItem({ id: "dismissed-item", status: "dismissed" }),
      makeItem({ id: "snoozed-item", snoozedUntil: "2025-06-20T00:00:00Z" }),
      makeItem({ id: "future-item", dueBy: "2025-07-01" }),
    ],
  };

  const items = fromWaitingStore(store, { now: NOW });

  assert.equal(items.length, 0);
});

test("a much-surfaced entry stops interrupting", () => {
  const store = {
    version: 1,
    items: [makeItem({ dueBy: "2025-06-14", surfaced: 3 })],
  };

  const items = fromWaitingStore(store, { now: NOW });

  assert.equal(items.length, 1);
  assert.equal(items[0].signals.interruptibility, 0.1);
});

test("an invalid store is refused", () => {
  // Missing version field
  assert.throws(
    () => fromWaitingStore({ items: [] }, { now: NOW }),
    { name: "TypeError", message: "invalid waiting store" }
  );

  // null store
  assert.throws(
    () => fromWaitingStore(null, { now: NOW }),
    { name: "TypeError", message: "invalid waiting store" }
  );
});
