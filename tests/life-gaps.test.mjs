import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { freeGaps } from "../scripts/lib/life/gaps.mjs";

describe("life-gaps", () => {
  const window = { start: 480, end: 1320 }; // 08:00 to 22:00

  it("an empty day is one gap", () => {
    const result = freeGaps([], window);
    assert.deepStrictEqual(result, [{ start: 480, end: 1320 }]);
  });

  it("gaps sit between blocks", () => {
    const blocks = [
      { id: "a", title: "A", kind: "class", date: "2026-01-01", start: 540, end: 600, fixed: true, source: "calendar" },
      { id: "b", title: "B", kind: "meal", date: "2026-01-01", start: 720, end: 780, fixed: false, source: "template" },
    ];
    const result = freeGaps(blocks, window);
    assert.deepStrictEqual(result, [
      { start: 480, end: 540 },
      { start: 600, end: 720 },
      { start: 780, end: 1320 },
    ]);
  });

  it("overlapping blocks merge", () => {
    const blocks = [
      { id: "a", title: "A", kind: "class", date: "2026-01-01", start: 540, end: 660, fixed: true, source: "calendar" },
      { id: "b", title: "B", kind: "study", date: "2026-01-01", start: 600, end: 720, fixed: false, source: "orion" },
    ];
    const result = freeGaps(blocks, window);
    // Merged block is 540-720. Gaps are before and after.
    assert.deepStrictEqual(result, [
      { start: 480, end: 540 },
      { start: 720, end: 1320 },
    ]);
  });

  it("buffers apply only around fixed blocks", () => {
    const blocks = [
      { id: "a", title: "A", kind: "class", date: "2026-01-01", start: 540, end: 600, fixed: true, source: "calendar" },
      { id: "b", title: "B", kind: "meal", date: "2026-01-01", start: 720, end: 780, fixed: false, source: "template" },
    ];
    const result = freeGaps(blocks, window, { buffer: 30 });
    // Fixed block A gets buffer: 510-630. Non-fixed B stays: 720-780.
    assert.deepStrictEqual(result, [
      { start: 480, end: 510 },
      { start: 630, end: 720 },
      { start: 780, end: 1320 },
    ]);
  });

  it("short gaps are dropped", () => {
    const blocks = [
      { id: "a", title: "A", kind: "class", date: "2026-01-01", start: 540, end: 600, fixed: true, source: "calendar" },
      { id: "b", title: "B", kind: "meal", date: "2026-01-01", start: 610, end: 620, fixed: false, source: "template" }, // 10 min gap before this
    ];
    const result = freeGaps(blocks, window);
    // Gap between A and B is 600-610 (10 mins), which is < default minimum 15.
    assert.deepStrictEqual(result, [
      { start: 480, end: 540 },
      { start: 620, end: 1320 },
    ]);
  });

  it("blocks outside the window are ignored", () => {
    const blocks = [
      { id: "a", title: "A", kind: "class", date: "2026-01-01", start: 300, end: 450, fixed: true, source: "calendar" }, // Before window
      { id: "b", title: "B", kind: "meal", date: "2026-01-01", start: 1400, end: 1500, fixed: false, source: "template" }, // After window
    ];
    const result = freeGaps(blocks, window);
    assert.deepStrictEqual(result, [{ start: 480, end: 1320 }]);
  });
});
