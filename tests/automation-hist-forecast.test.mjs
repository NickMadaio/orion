import { strictEqual, deepStrictEqual, notStrictEqual } from "node:assert/strict";
import { describe, it, after as t_after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withHistory, NO_HISTORY_NOTE, FOCUS_NOT_MODELLED } from "../scripts/lib/orion-automation-history-forecast.mjs";

const baseForecast = {
  fireCount: 30,
  suppressedCount: 0,
  messageCount: 30,
  windowDays: 30,
  cappedByRiskLimit: false,
  notes: [
    "This is a CEILING, not a forecast: x",
    FOCUS_NOT_MODELLED,
  ],
};

describe("withHistory", () => {
  it("no observed days keeps the ceiling and adds the no-history note", () => {
    const summary = {
      windowDays: 30,
      from: Date.now(),
      entries: 0,
      observedDays: 0,
      firings: 0,
      suppressed: 0,
      refused: 0,
      succeeded: 0,
      failed: 0,
      unknown: 0,
      delivered: 0,
      withheld: 0,
      byReason: {},
      perDay: {},
    };

    const result = withHistory(baseForecast, summary);

    // Numbers unchanged
    strictEqual(result.fireCount, 30);
    strictEqual(result.suppressedCount, 0);
    strictEqual(result.messageCount, 30);

    // No observed key
    notStrictEqual("observed" in result, true);

    // Last note is NO_HISTORY_NOTE
    strictEqual(result.notes.at(-1), NO_HISTORY_NOTE);
  });

  it("observed days add an observed section and note", () => {
    const summary = {
      windowDays: 30,
      from: Date.now(),
      entries: 7,
      observedDays: 5,
      firings: 4,
      suppressed: 3,
      refused: 0,
      succeeded: 3,
      failed: 1,
      unknown: 0,
      delivered: 2,
      withheld: 1,
      byReason: {},
      perDay: {},
    };

    const result = withHistory(baseForecast, summary);

    deepStrictEqual(result.observed, {
      windowDays: 30,
      observedDays: 5,
      firings: 4,
      suppressed: 3,
      delivered: 2,
    });

    strictEqual(
      result.notes.at(-1),
      "Observed on 5 of the last 30 day(s): fired 4, suppressed 3, delivered 2.",
    );
  });

  it("the focus note is replaced when history exists", () => {
    const summary = {
      windowDays: 30,
      from: Date.now(),
      entries: 7,
      observedDays: 5,
      firings: 4,
      suppressed: 3,
      refused: 0,
      succeeded: 3,
      failed: 1,
      unknown: 0,
      delivered: 2,
      withheld: 1,
      byReason: { focus_active: 2, focus_unknown: 1 },
      perDay: {},
    };

    const result = withHistory(baseForecast, summary);

    // The replaced note is present
    const focusNote = "Focus sessions suppressed 3 firing(s) in the observed days.";
    strictEqual(result.notes.includes(focusNote), true);

    // The original FOCUS_NOT_MODELLED is gone
    strictEqual(result.notes.includes(FOCUS_NOT_MODELLED), false);
  });

  it("does not mutate the forecast or the summary", () => {
    const frozenForecast = Object.freeze({
      ...baseForecast,
      notes: Object.freeze([...baseForecast.notes]),
    });

    const summary = {
      windowDays: 30,
      from: Date.now(),
      entries: 7,
      observedDays: 5,
      firings: 4,
      suppressed: 3,
      refused: 0,
      succeeded: 3,
      failed: 1,
      unknown: 0,
      delivered: 2,
      withheld: 1,
      byReason: { focus_active: 2, focus_unknown: 1 },
      perDay: {},
    };
    const frozenSummary = Object.freeze({
      ...summary,
      byReason: Object.freeze(summary.byReason),
      perDay: Object.freeze(summary.perDay),
    });

    // Must not throw
    const result = withHistory(frozenForecast, frozenSummary);

    // Originals unchanged (they are frozen so this is guaranteed, but the point is no mutation)
    strictEqual(frozenForecast.notes.length, 2);
    strictEqual(Object.keys(frozenSummary.byReason).length, 2);

    // Result has new notes array
    notStrictEqual(result.notes, frozenForecast.notes);
  });

  it("a missing summary is treated as no history", () => {
    const result = withHistory(baseForecast, null);

    strictEqual(result.notes.at(-1), NO_HISTORY_NOTE);
  });
});
