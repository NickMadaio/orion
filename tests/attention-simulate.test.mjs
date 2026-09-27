import { strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { simulateAttentionDay } from "../scripts/lib/attention/simulate.mjs";

/**
 * Build a minimal attention entry.
 */
function makeEntry(id, signals = {}) {
  return {
    id,
    source: "manual",
    kind: "test",
    title: `Test ${id}`,
    detail: "",
    observedAt: 1700000000000,
    dueAt: null,
    expiresAt: null,
    dedupKey: id,
    signals: {
      urgency: 0.5,
      actionability: 0.5,
      novelty: null,
      confidence: 0.9,
      importance: null,
      interruptibility: null,
      ...signals,
    },
  };
}

describe("simulateAttentionDay", () => {
  const day = "2024-01-15";

  it("urgent items interrupt once each", () => {
    // Create several high-urgency entries that should rank as "now" and interrupt
    const entries = [
      makeEntry("urgent:1", { urgency: 0.9, actionability: 0.8 }),
      makeEntry("urgent:2", { urgency: 0.95, actionability: 0.7 }),
      makeEntry("urgent:3", { urgency: 0.85, actionability: 0.6 }),
    ];

    const result = simulateAttentionDay(entries, {
      day,
      budget: { maxPerHour: 5 },
    });

    // All three should interrupt (budget allows up to 5/hour)
    strictEqual(result.interrupts, 3);
    strictEqual(result.filed, 0);
    strictEqual(result.blockedByBudget, 0);
  });

  it("the budget turns excess interruptions into filed items", () => {
    // 5 urgent entries at one hour with maxPerHour: 2
    const entries = [
      makeEntry("b1", { urgency: 0.9, actionability: 0.8 }),
      makeEntry("b2", { urgency: 0.9, actionability: 0.8 }),
      makeEntry("b3", { urgency: 0.9, actionability: 0.8 }),
      makeEntry("b4", { urgency: 0.9, actionability: 0.8 }),
      makeEntry("b5", { urgency: 0.9, actionability: 0.8 }),
    ];

    const result = simulateAttentionDay(entries, {
      day,
      budget: { maxPerHour: 2 },
    });

    // Only 2 can interrupt in that hour; the other 3 are blocked and filed
    strictEqual(result.interrupts, 2);
    strictEqual(result.blockedByBudget, 3);
    strictEqual(result.filed, 3);
  });

  it("quiet hours file what is not urgent", () => {
    // During quiet hours, non-urgent items should be routed to "today" (later),
    // meaning they never rank as "now" and thus get filed at end of day.
    const entries = [
      makeEntry("q1", { urgency: 0.3, actionability: 0.4 }),
      makeEntry("q2", { urgency: 0.2, actionability: 0.3 }),
    ];

    // Make all hours quiet so nothing interrupts
    const result = simulateAttentionDay(entries, {
      day,
      quietHours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    });

    // Nothing should interrupt; both get filed at end of day
    strictEqual(result.interrupts, 0);
    strictEqual(result.filed, 2);
    strictEqual(result.blockedByBudget, 0);
  });

  it("perHour covers the whole day", () => {
    const entries = [makeEntry("ph1", { urgency: 0.9, actionability: 0.8 })];

    const result = simulateAttentionDay(entries, { day });

    strictEqual(result.perHour.length, 24);
    // Check that hours are 0..23
    for (let i = 0; i < 24; i++) {
      strictEqual(result.perHour[i].hour, i);
    }
  });
});

