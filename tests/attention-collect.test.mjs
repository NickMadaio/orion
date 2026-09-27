import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { collectAttention } from "../scripts/lib/attention/collect.mjs";

const NOW = 1790000000000;

describe("att-collect", () => {
  it("items from every source are combined", async () => {
    const readers = {
      calendar: async () => [
        { title: "Standup", start: new Date(NOW + 10 * 60_000).toISOString(), identifier: "cal-standup" },
      ],
      waiting: async () => ({
        version: 1,
        items: [
          {
            id: "w1",
            status: "open",
            who: "Alice",
            what: "code review",
            dueBy: new Date(NOW).toISOString().slice(0, 10),
            expect: "by EOD",
            surfaced: 0,
          },
        ],
      }),
      focusHistory: async () => [],
    };

    const { items, outages } = await collectAttention({ now: NOW, readers });

    assert.strictEqual(outages.length, 0, "no outages expected");
    assert.ok(items.length >= 2, `expected at least 2 items, got ${items.length}`);

    // Check sources present
    const sources = new Set(items.map((i) => i.source));
    assert.ok(sources.has("calendar"), "missing calendar item");
    assert.ok(sources.has("waiting"), "missing waiting item");
  });

  it("a failing source is an outage, not silence", async () => {
    const readers = {
      calendar: async () => { throw new Error("calendar API down"); },
      waiting: async () => ({
        version: 1,
        items: [
          {
            id: "w1",
            status: "open",
            who: "Bob",
            what: "design doc",
            dueBy: new Date(NOW).toISOString().slice(0, 10),
            expect: "tomorrow",
            surfaced: 0,
          },
        ],
      }),
    };

    const { items, outages } = await collectAttention({ now: NOW, readers });

    assert.strictEqual(outages.length, 1);
    assert.strictEqual(outages[0].source, "calendar");
    assert.ok(outages[0].message.includes("calendar API down"));

    // Waiting items still returned
    assert.ok(items.length >= 1, "waiting items should still be present");
    assert.strictEqual(items[0].source, "waiting");
  });

  it("an invalid store is an outage", async () => {
    const readers = {
      waiting: async () => ({}),
    };

    const { items, outages } = await collectAttention({ now: NOW, readers });

    assert.strictEqual(outages.length, 1);
    assert.strictEqual(outages[0].source, "waiting");
    assert.strictEqual(items.length, 0);
  });

  it("unconfigured sources are ignored", async () => {
    const { items, outages } = await collectAttention({ now: NOW, readers: {} });

    assert.deepStrictEqual(items, []);
    assert.deepStrictEqual(outages, []);
  });
});
