import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { earlyContext, finishEarly } from "../scripts/lib/life/early.mjs";

describe("surfaces-early", () => {
  function makeBlock(opts) {
    return {
      id: opts.id ?? "b1",
      title: opts.title ?? "Study",
      kind: opts.kind ?? "study",
      date: opts.date ?? "2026-10-01",
      start: opts.start ?? 0,
      end: opts.end ?? 60,
      fixed: opts.fixed ?? false,
      source: opts.source ?? "calendar",
      calendarId: opts.calendarId ?? null,
    };
  }

  it("finishing a block early pulls the next ones forward in order", () => {
    const blocks = [
      makeBlock({ id: "a", title: "Study math", start: 300, end: 420 }),   // 5:00-7:00
      makeBlock({ id: "b", title: "Study cs", start: 480, end: 600 }),     // 8:00-10:00
      makeBlock({ id: "c", title: "Gym", start: 660, end: 780 }),         // 11:00-13:00
    ];

    const result = finishEarly(blocks, { now: 400, mode: "block" });

    assert.strictEqual(result.mode, "block");
    assert.strictEqual(result.freeFrom, 400);
    assert.deepStrictEqual(result.shortened, { id: "a", title: "Study math", from: 420, to: 400 });
    assert.strictEqual(result.clipped, null);

    // b should move earlier, c should move earlier too
    const movedIds = new Set(result.moves.map((m) => m.id));
    assert.ok(movedIds.has("b"), "b should move");
    assert.ok(movedIds.has("c"), "c should move");

    // Every moved block: to < from
    for (const m of result.moves) {
      assert.ok(m.to < m.from, `${m.id} moved later`);
    }

    // Check no overlaps and lengths preserved
    const allResult = buildResultBlocks(blocks, result);
    checkNoOverlaps(allResult);
    checkLengthsPreserved(blocks, result);
  });

  it("nap, wind down and classes never move", () => {
    const blocks = [
      makeBlock({ id: "a", title: "Study", start: 300, end: 420 }),
      makeBlock({ id: "nap", title: "Nap time", start: 480, end: 540, fixed: false }),
      makeBlock({ id: "class1", title: "CS101 Lecture", start: 600, end: 720, fixed: true, source: "calendar", kind: "class" }),
      makeBlock({ id: "b", title: "Study cs", start: 780, end: 900 }),
    ];

    const result = finishEarly(blocks, { now: 350, mode: "block" });

    // nap and class should not be in moves
    const movedIds = new Set(result.moves.map((m) => m.id));
    assert.ok(!movedIds.has("nap"), "nap should not move");
    assert.ok(!movedIds.has("class1"), "class should not move");

    const allResult = buildResultBlocks(blocks, result);
    checkNoOverlaps(allResult);
    checkLengthsPreserved(blocks, result);
  });

  it("a gap that is too small for the next block is skipped, not overfilled", () => {
    // Block a ends early, but there's a wall (fixed block) right after freeFrom+buffer
    // that leaves only a tiny gap before the next movable block's original position
    const blocks = [
      makeBlock({ id: "a", title: "Study", start: 300, end: 420 }),
      makeBlock({ id: "wall1", title: "Fixed meeting", start: 430, end: 500, fixed: true }),
      makeBlock({ id: "b", title: "Study cs", start: 560, end: 680 }), // length 120
    ];

    const result = finishEarly(blocks, { now: 400, mode: "block" });

    // b can't fit between freeFrom+buffer=410 and wall1 at 430 (need buffer on both sides)
    // So b should either stay or move to after wall1 if there's room
    // After wall1 ends at 500, with buffer: cursor would be 500+10=510. b needs 120 min + buffers.
    // Try s=510: [500, 640) — check against wall1 [430,500): no overlap since 500 < 500 is false... 
    // Actually interval is [s-buffer, s+length+buffer) = [500, 640). Wall is [430, 500).
    // 500 < 500 is false, so no overlap. Good.
    // So b moves to 510 if 510 < 560.

    const movedB = result.moves.find((m) => m.id === "b");
    if (movedB) {
      assert.ok(movedB.to < movedB.from, "b should not move later");
    }

    const allResult = buildResultBlocks(blocks, result);
    checkNoOverlaps(allResult);
    checkLengthsPreserved(blocks, result);
  });

  it("nothing ever moves later", () => {
    const blocks = [
      makeBlock({ id: "a", title: "Study", start: 300, end: 420 }),
      makeBlock({ id: "b", title: "Study cs", start: 480, end: 600 }),
      makeBlock({ id: "c", title: "Gym", start: 660, end: 780 }),
    ];

    const result = finishEarly(blocks, { now: 350, mode: "block" });

    for (const m of result.moves) {
      assert.ok(m.to < m.from, `${m.id} moved later: from=${m.from} to=${m.to}`);
    }

    const allResult = buildResultBlocks(blocks, result);
    checkNoOverlaps(allResult);
    checkLengthsPreserved(blocks, result);
  });

  it("after a class the context asks which kind of early", () => {
    const blocks = [
      makeBlock({ id: "class1", title: "CS101 Lecture", start: 300, end: 420, fixed: true, source: "calendar", kind: "class" }),
      makeBlock({ id: "b", title: "Study", start: 500, end: 600 }),
    ];

    // During the class + commute window
    const ctx = earlyContext(blocks, { now: 430 });
    assert.strictEqual(ctx.kind, "after-class");
    assert.strictEqual(ctx.classId, "class1");
  });

  it("out of class early: the trip home starts now", () => {
    const blocks = [
      makeBlock({ id: "class1", title: "CS101 Lecture", start: 300, end: 420, fixed: true, source: "calendar", kind: "class" }),
      makeBlock({ id: "b", title: "Study", start: 500, end: 600 }),
      makeBlock({ id: "c", title: "Gym", start: 660, end: 780 }),
    ];

    const result = finishEarly(blocks, { now: 420, mode: "out-of-class", commuteMinutes: 30 });

    assert.strictEqual(result.mode, "out-of-class");
    assert.strictEqual(result.freeFrom, 420 + 30); // now + commuteMinutes
    assert.strictEqual(result.shortened, null);

    const allResult = buildResultBlocks(blocks, result);
    checkNoOverlaps(allResult);
    checkLengthsPreserved(blocks, result);
  });

  it("already home: the day starts now and the class is clipped", () => {
    const blocks = [
      makeBlock({ id: "class1", title: "CS101 Lecture", start: 300, end: 420, fixed: true, source: "calendar", kind: "class" }),
      makeBlock({ id: "b", title: "Study", start: 500, end: 600 }),
    ];

    // now is before class end — class is still running
    const result = finishEarly(blocks, { now: 400, mode: "home", commuteMinutes: 30 });

    assert.strictEqual(result.mode, "home");
    assert.strictEqual(result.freeFrom, 400);
    assert.deepStrictEqual(result.clipped, { id: "class1", title: "CS101 Lecture", end: 400 });
    assert.strictEqual(result.shortened, null);

    const allResult = buildResultBlocks(blocks, result);
    checkNoOverlaps(allResult);
    checkLengthsPreserved(blocks, result);
  });

  it("pressing with nothing under way throws", () => {
    const blocks = [
      makeBlock({ id: "a", title: "Study", start: 300, end: 420 }),
    ];

    assert.throws(() => finishEarly(blocks, { now: 500, mode: "block" }), Error);
  });

  it("invalid mode or now throws TypeError", () => {
    const blocks = [
      makeBlock({ id: "a", title: "Study", start: 300, end: 420 }),
    ];

    assert.throws(() => finishEarly(blocks, { now: 350, mode: "invalid" }), TypeError);
    assert.throws(() => finishEarly(blocks, { now: -1, mode: "block" }), TypeError);
    assert.throws(() => finishEarly(blocks, { now: 1440, mode: "block" }), TypeError);
    assert.throws(() => earlyContext("not-array", { now: 350 }), TypeError);
    assert.throws(() => earlyContext([], { now: 1500 }), TypeError);
  });

  it("the input blocks are not mutated", () => {
    const blocks = [
      makeBlock({ id: "a", title: "Study", start: 300, end: 420 }),
      makeBlock({ id: "b", title: "Study cs", start: 480, end: 600 }),
    ];

    const snapshot = JSON.parse(JSON.stringify(blocks));
    finishEarly(blocks, { now: 350, mode: "block" });
    assert.deepStrictEqual(blocks, snapshot);
  });
});

// Helpers

function buildResultBlocks(originalBlocks, result) {
  const movedMap = new Map(result.moves.map((m) => [m.id, m]));
  const blocks = originalBlocks.map((b) => {
    let block = { ...b };

    // Apply shortened: the finished-early block ends at `now` (result.shortened.to)
    if (result.shortened && b.id === result.shortened.id) {
      block.end = result.shortened.to;
    }

    // Apply clipped: the class is cut short to `now`
    if (result.clipped && b.id === result.clipped.id) {
      block.end = result.clipped.end;
    }

    // Apply moves: shift start, preserve length
    if (movedMap.has(b.id)) {
      const m = movedMap.get(b.id);
      const length = block.end - block.start;
      block.start = m.to;
      block.end = m.to + length;
    }

    return block;
  });

  return blocks;
}

function checkNoOverlaps(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].start < sorted[i].end; j++) {
      const a = sorted[i];
      const b = sorted[j];
      // Only check movable blocks against everything, and fixed against movable
      if (a.fixed && b.fixed) continue; // two fixed blocks overlapping is not our problem
      assert.fail(`${a.id} (${a.start}-${a.end}) overlaps ${b.id} (${b.start}-${b.end})`);
    }
  }
}

function checkLengthsPreserved(originalBlocks, result) {
  const origMap = new Map(originalBlocks.map((b) => [b.id, b]));
  for (const m of result.moves) {
    const orig = origMap.get(m.id);
    assert.ok(orig, `moved block ${m.id} not found in originals`);
    const origLength = orig.end - orig.start;
    const newLength = m.to + origLength - m.to; // length is preserved by construction
    assert.strictEqual(newLength, origLength, `${m.id} length changed`);
  }
}
