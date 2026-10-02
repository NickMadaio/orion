import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { listsToBlock, LISTS } from "../scripts/lib/focus/phone-lists.mjs";

const normalUsed = { messaging: 10, feeds: 30, video: 20, games: 15 };

describe("phone-lists", () => {
  it("nothing is blocked on a normal day", () => {
    const result = listsToBlock({
      block: null,
      usedToday: { ...normalUsed },
      current: null,
      escalation: "none",
    });
    assert.deepStrictEqual(result.block, []);
    assert.deepStrictEqual(result.keep, LISTS);
  });

  it("two hours of feeds blocks feeds only", () => {
    const result = listsToBlock({
      block: null,
      usedToday: { messaging: 10, feeds: 120, video: 20, games: 15 },
      current: "feeds",
      escalation: "none",
    });
    assert.deepStrictEqual(result.block, ["feeds"]);
    assert.deepStrictEqual(result.keep, ["messaging", "video", "games"]);
  });

  it("carrying on in video after feeds is capped blocks video too", () => {
    const result = listsToBlock({
      block: null,
      usedToday: { messaging: 10, feeds: 120, video: 35, games: 15 },
      current: "video",
      escalation: "none",
    });
    assert.deepStrictEqual(result.block, ["feeds", "video"]);
    assert.deepStrictEqual(result.keep, ["messaging", "games"]);
  });

  it("a focus block at the block step leaves messaging open", () => {
    const result = listsToBlock({
      block: { id: "s1", title: "Study", kind: "study", date: "2026-01-01", start: 480, end: 540, fixed: true, source: "ical" },
      usedToday: { ...normalUsed },
      current: null,
      escalation: "block",
    });
    assert.deepStrictEqual(result.block, ["feeds", "video", "games"]);
    assert.deepStrictEqual(result.keep, ["messaging"]);
  });

  it("messaging is blocked only when it is the distraction and not allowed", () => {
    const result = listsToBlock({
      block: { id: "s1", title: "Study", kind: "study", date: "2026-01-01", start: 480, end: 540, fixed: true, source: "ical" },
      usedToday: { ...normalUsed },
      current: "messaging",
      escalation: "block",
      allowMessaging: false,
    });
    assert.deepStrictEqual(result.block, ["messaging", "feeds", "video", "games"]);
    assert.deepStrictEqual(result.keep, []);
  });

  it("a nap or meal block never triggers the focus rule", () => {
    const result = listsToBlock({
      block: { id: "n1", title: "Nap", kind: "rest", date: "2026-01-01", start: 780, end: 840, fixed: false, source: "ical" },
      usedToday: { messaging: 10, feeds: 30, video: 20, games: 15 },
      current: null,
      escalation: "block",
    });
    assert.deepStrictEqual(result.block, []);
    assert.deepStrictEqual(result.keep, LISTS);
  });

  it("the output is ordered and has no duplicates", () => {
    const result = listsToBlock({
      block: null,
      usedToday: { messaging: 10, feeds: 120, video: 130, games: 95 },
      current: null,
      escalation: "none",
    });
    // All three capped lists should appear in LISTS order
    assert.deepStrictEqual(result.block, ["feeds", "video", "games"]);
    assert.deepStrictEqual(result.keep, ["messaging"]);
    // Verify no duplicates
    const blockSet = new Set(result.block);
    assert.strictEqual(blockSet.size, result.block.length);
  });

  it("invalid input throws TypeError", () => {
    // unknown list name in current
    assert.throws(
      () => listsToBlock({ block: null, usedToday: normalUsed, current: "unknown", escalation: "none" }),
      TypeError
    );
    // negative minutes
    assert.throws(
      () => listsToBlock({ block: null, usedToday: { messaging: 10, feeds: -5, video: 20, games: 15 }, current: null, escalation: "none" }),
      TypeError
    );
    // missing key
    assert.throws(
      () => listsToBlock({ block: null, usedToday: { messaging: 10, feeds: 30, video: 20 }, current: null, escalation: "none" }),
      TypeError
    );
  });
});
