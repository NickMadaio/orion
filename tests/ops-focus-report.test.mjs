import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { focusReport } from "../scripts/lib/orion-focus-report.mjs";

describe("ops-focus-report", () => {
  const day1 = "2026-08-11T02:00:00Z";
  const day1Ms = Date.parse(day1);
  const day2 = "2026-08-12T02:00:00Z";
  const day2Ms = Date.parse(day2);

  function makeRow(startedAt, servedFocusSeconds, completedFocusBlocks = 0, reason = null, task = "Focus") {
    return {
      startedAt,
      endedAt: new Date(Date.parse(startedAt) + servedFocusSeconds * 1000).toISOString(),
      servedFocusSeconds,
      completedFocusBlocks,
      totalFocusBlocks: 3,
      reason: reason ?? "completed",
      task,
      approximate: false,
    };
  }

  it("sessions and minutes add up per day", () => {
    const rows = [
      makeRow(day1, 900),   // 15 min
      makeRow(day1, 600),   // 10 min
      makeRow(day2, 1800),  // 30 min
    ];

    const from = day1Ms;
    const to = Date.parse("2026-08-13T00:00:00Z");

    const result = focusReport(rows, { from, to });

    assert.equal(result.totals.sessions, 3);
    assert.equal(result.totals.focusMinutes, 55.0); // (900+600+1800)/60 = 55

    assert.equal(result.byDay["2026-08-11"].sessions, 2);
    assert.equal(result.byDay["2026-08-11"].focusMinutes, 25.0); // (900+600)/60 = 25

    assert.equal(result.byDay["2026-08-12"].sessions, 1);
    assert.equal(result.byDay["2026-08-12"].focusMinutes, 30.0);
  });

  it("early ends and blocks are counted", () => {
    const rows = [
      makeRow(day1, 900, 2, "completed"),
      makeRow(day1, 300, 0, "early"),
      makeRow(day1, 600, 1, "early"),
    ];

    const from = day1Ms;
    const to = Date.parse("2026-08-12T00:00:00Z");

    const result = focusReport(rows, { from, to });

    assert.equal(result.totals.earlyEnds, 2);
    assert.equal(result.totals.completedBlocks, 3); // 2 + 0 + 1
    assert.equal(result.byDay["2026-08-11"].earlyEnds, 2);
    assert.equal(result.byDay["2026-08-11"].completedBlocks, 3);
  });

  it("the longest session is named", () => {
    const rows = [
      makeRow(day1, 900, 1, "completed", "Deep Work"),
      makeRow(day1, 1800, 2, "completed", "Writing"),
      makeRow(day2, 600, 0, "early", "Review"),
    ];

    const from = day1Ms;
    const to = Date.parse("2026-08-13T00:00:00Z");

    const result = focusReport(rows, { from, to });

    assert.equal(result.longest.task, "Writing");
    assert.equal(result.longest.minutes, 30.0); // 1800/60
    assert.equal(result.longest.startedAt, day1);
  });

  it("the window and bad rows are respected", () => {
    const beforeWindow = "2026-08-10T02:00:00Z";
    const afterWindow = "2026-08-13T02:00:00Z";

    const rows = [
      makeRow(beforeWindow, 900),   // outside window → excluded
      makeRow(day1, 900),           // inside
      makeRow(afterWindow, 600),    // outside window → excluded
      null,                         // malformed → skipped
      { startedAt: day1, servedFocusSeconds: NaN }, // malformed → skipped
      { startedAt: "not-a-date", servedFocusSeconds: 100 }, // malformed → skipped
    ];

    const from = day1Ms;
    const to = Date.parse("2026-08-12T00:00:00Z");

    const result = focusReport(rows, { from, to });

    assert.equal(result.totals.sessions, 1);
    assert.equal(result.skipped, 3); // null, NaN seconds, bad date string
    // Outside-window rows are excluded, not skipped
    assert.equal(Object.keys(result.byDay).length, 1);
  });
});
