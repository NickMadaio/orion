import { strict as assert } from "node:assert";
import { describe, it, before } from "node:test";
import { fromCalendarEvents } from "../scripts/lib/attention/sources/calendar.mjs";

const NOW = 1_700_000_000_000; // fixed clock

describe("att-src-calendar", () => {
  it("an event inside the horizon becomes a starting-soon item", () => {
    const startMs = NOW + 20 * 60_000; // 20 min from now
    const events = [
      {
        identifier: "evt-1",
        title: "Seminar",
        start: new Date(startMs).toISOString(),
      },
    ];

    const { items, skipped } = fromCalendarEvents(events, { now: NOW });

    assert.strictEqual(items.length, 1);
    assert.strictEqual(skipped, 0);

    const item = items[0];
    assert.strictEqual(item.kind, "starting_soon");
    assert.strictEqual(item.title, "Seminar starts in 20 min");
    assert.strictEqual(item.signals.urgency, 0.8);
    assert.strictEqual(item.source, "calendar");
    assert.strictEqual(item.dueAt, startMs);
    assert.strictEqual(item.expiresAt, startMs + 15 * 60_000);
    assert.strictEqual(item.observedAt, NOW);
  });

  it("startDate is read when start is absent", () => {
    const startMs = NOW + 25 * 60_000;
    const events = [
      {
        identifier: "evt-2",
        title: "Meeting",
        startDate: new Date(startMs).toISOString(),
      },
    ];

    const { items, skipped } = fromCalendarEvents(events, { now: NOW });

    assert.strictEqual(items.length, 1);
    assert.strictEqual(skipped, 0);
    assert.strictEqual(items[0].dueAt, startMs);
  });

  it("all-day, past and far-future events are ignored", () => {
    const allDayEvent = {
      identifier: "ad-1",
      title: "All Day Thing",
      start: new Date(NOW + 30 * 60_000).toISOString(),
      isAllDay: true,
    };

    const pastEvent = {
      identifier: "past-1",
      title: "Old Event",
      start: new Date(NOW - 60 * 60_000).toISOString(), // 1 hour ago
    };

    const farFutureEvent = {
      identifier: "far-1",
      title: "Far Future",
      start: new Date(NOW + 24 * 60 * 60_000).toISOString(), // 24 hours away
    };

    const events = [allDayEvent, pastEvent, farFutureEvent];

    const { items, skipped } = fromCalendarEvents(events, { now: NOW });

    assert.strictEqual(items.length, 0);
    assert.strictEqual(skipped, 0);
  });

  it("unreadable events are counted", () => {
    const events = [
      { title: "x" }, // no start/startDate -> NaN
      "junk",         // not an object
    ];

    const { items, skipped } = fromCalendarEvents(events, { now: NOW });

    assert.strictEqual(items.length, 0);
    assert.strictEqual(skipped, 2);
  });

  it("ids are stable and safe", () => {
    const startMs = NOW + 15 * 60_000;
    const isoStart = new Date(startMs).toISOString();
    const events = [
      { identifier: "ABC/123:x", title: "Test", start: isoStart },
      { identifier: "ABC/123:x", title: "Test", start: isoStart },
    ];

    const result1 = fromCalendarEvents(events, { now: NOW });
    const result2 = fromCalendarEvents(events, { now: NOW });

    // Same id for both occurrences within one call
    assert.strictEqual(result1.items[0].id, result1.items[1].id);

    // Stable across calls
    assert.strictEqual(result1.items[0].id, result2.items[0].id);

    // Matches the safe pattern
    const id = result1.items[0].id;
    assert.match(id, /^[a-z0-9][a-z0-9:._-]{1,95}$/);

    // The identifier "ABC/123:x" should become "abc-123-x" after sanitization
    assert.strictEqual(id, "calendar:abc-123-x");
  });
});
