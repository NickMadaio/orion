import { strict as assert } from "node:assert";
import { describe, it, after } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dedupAttentionItems } from "../scripts/lib/attention/dedup.mjs";

describe("dedupAttentionItems", () => {
  let tmp;

  it.beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "orion-att-dedup-"));
  });

  after(async () => {
    // cleanup handled by OS for temp dirs in most cases
  });

  function item(id, observedAt, dedupKey) {
    return {
      id,
      source: "manual",
      kind: "test",
      title: "Test item",
      detail: "",
      observedAt,
      dueAt: null,
      expiresAt: null,
      dedupKey,
      signals: {
        urgency: null,
        actionability: null,
        novelty: null,
        confidence: null,
        importance: null,
        interruptibility: null,
      },
    };
  }

  it("the newest of a key wins", () => {
    const t = Date.now();
    const items = [
      item("a", t, "k"),
      item("b", t + 1000, "k"),
      item("c", t + 2000, "k"),
    ];

    const { kept, dropped } = dedupAttentionItems(items);

    assert.equal(kept.length, 1, "only one item kept");
    assert.equal(kept[0].id, "c", "newest is kept");
    assert.equal(dropped.length, 2, "two items dropped");
    for (const d of dropped) {
      assert.equal(d.keptId, "c", "dropped items reference the newest");
    }
  });

  it("different keys are independent", () => {
    const t = Date.now();
    const items = [
      item("a1", t, "a"),
      item("b1", t + 500, "b"),
    ];

    const { kept, dropped } = dedupAttentionItems(items);

    assert.equal(kept.length, 2, "both items kept");
    assert.equal(dropped.length, 0, "nothing dropped");
  });

  it("an old occurrence outside the window survives", () => {
    // Default window is 6 hours. Place two items of the same key 7 hours apart.
    const t = Date.now();
    const sevenHours = 7 * 3_600_000;
    const items = [
      item("old", t, "k"),
      item("new", t + sevenHours, "k"),
    ];

    const { kept, dropped } = dedupAttentionItems(items);

    assert.equal(kept.length, 2, "both kept because outside window");
    assert.equal(dropped.length, 0, "nothing dropped");
  });

  it("ties break by id", () => {
    const t = Date.now();
    const items = [
      item("x1", t, "k"),
      item("x2", t, "k"),
    ];

    const { kept, dropped } = dedupAttentionItems(items);

    assert.equal(kept.length, 1, "one kept");
    assert.equal(kept[0].id, "x2", "larger id wins the tie");
    assert.equal(dropped.length, 1, "one dropped");
    assert.equal(dropped[0].id, "x1");
    assert.equal(dropped[0].keptId, "x2");
  });

  it("input is not mutated", () => {
    const t = Date.now();
    const items = [
      item("a", t, "k"),
      item("b", t + 1000, "k"),
    ];

    // Freeze everything deeply enough that any mutation throws.
    Object.freeze(items);
    for (const it of items) {
      Object.freeze(it);
      Object.freeze(it.signals);
    }

    assert.doesNotThrow(() => dedupAttentionItems(items));
  });
});
