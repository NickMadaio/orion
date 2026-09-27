import { strictEqual } from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rankAttention } from "../scripts/lib/attention/rank.mjs";

describe("att-rank", async () => {
  let tmp;

  before(async () => {
    tmp = await mkdtemp(join(tmpdir(), "orion-att-rank-"));
  });

  after(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const NOW = 1790000000000;

  function makeItem(overrides) {
    return {
      id: "cal:test001",
      source: "calendar",
      kind: "starting_soon",
      title: "Test item",
      detail: "",
      observedAt: NOW - 60000,
      dueAt: NOW + 3600000,
      expiresAt: null,
      dedupKey: "cal:test001",
      signals: {
        urgency: 0.5,
        actionability: 0.7,
        novelty: null,
        confidence: 0.9,
        importance: null,
        interruptibility: null,
      },
      ...overrides,
    };
  }

  it("a high-scoring item interrupts and a low one waits", () => {
    const high = makeItem({
      id: "cal:high",
      title: "Urgent meeting",
      signals: {
        urgency: 0.95,
        actionability: 0.9,
        novelty: null,
        confidence: 0.95,
        importance: null,
        interruptibility: null,
      },
    });

    const low = makeItem({
      id: "cal:low",
      title: "Read email later",
      signals: {
        urgency: 0.1,
        actionability: 0.3,
        novelty: null,
        confidence: 0.5,
        importance: null,
        interruptibility: null,
      },
    });

    const result = rankAttention([high, low], {
      now: NOW,
      hourOfDay: 10,
      quietHours: null,
      focusActive: false,
    });

    strictEqual(result.now.length, 1);
    strictEqual(result.now[0].id, "cal:high");
    strictEqual(result.later.length, 1);
    strictEqual(result.later[0].id, "cal:low");
    strictEqual(result.dropped.length, 0);
  });

  it("expired entries are dropped with their reason", () => {
    const expired = makeItem({
      id: "cal:expired",
      title: "Old event",
      expiresAt: NOW - 1000,
    });

    const alive = makeItem({
      id: "cal:alive",
      title: "Current event",
      expiresAt: NOW + 3600000,
    });

    const result = rankAttention([expired, alive], {
      now: NOW,
      hourOfDay: 10,
      quietHours: null,
      focusActive: false,
    });

    strictEqual(result.dropped.length, 1);
    strictEqual(result.dropped[0].id, "cal:expired");
    strictEqual(result.dropped[0].reason, "expired");
    // alive item should be in now or later (not dropped)
    const aliveFound = [...result.now, ...result.later].find(
      (r) => r.id === "cal:alive"
    );
    strictEqual(aliveFound !== undefined, true);
  });

  it("unknown focus files everything that is not very urgent", () => {
    const normal = makeItem({
      id: "cal:normal",
      title: "Normal item",
      signals: {
        urgency: 0.5,
        actionability: 0.7,
        novelty: null,
        confidence: 0.9,
        importance: null,
        interruptibility: null,
      },
    });

    const veryUrgent = makeItem({
      id: "cal:urgent",
      title: "Very urgent",
      signals: {
        urgency: 0.95,
        actionability: 0.9,
        novelty: null,
        confidence: 0.95,
        importance: null,
        interruptibility: null,
      },
    });

    const result = rankAttention([normal, veryUrgent], {
      now: NOW,
      hourOfDay: 10,
      quietHours: null,
      focusActive: null, // unknown
    });

    // normal item (urgency < 0.9) should go to later with reason "focus_unknown"
    const normalRow = result.later.find((r) => r.id === "cal:normal");
    strictEqual(normalRow !== undefined, true);
    strictEqual(normalRow.reason, "focus_unknown");

    // very urgent item (urgency >= 0.9) should interrupt
    const urgentRow = result.now.find((r) => r.id === "cal:urgent");
    strictEqual(urgentRow !== undefined, true);
  });

  it("ordering is by score, then due time, then id", () => {
    // Three items with different scores
    const itemA = makeItem({
      id: "cal:a",
      title: "Item A",
      signals: {
        urgency: 0.3,
        actionability: 0.5,
        novelty: null,
        confidence: 0.6,
        importance: null,
        interruptibility: null,
      },
      dueAt: NOW + 1000000,
    });

    const itemB = makeItem({
      id: "cal:b",
      title: "Item B",
      signals: {
        urgency: 0.8,
        actionability: 0.9,
        novelty: null,
        confidence: 0.95,
        importance: null,
        interruptibility: null,
      },
      dueAt: NOW + 2000000,
    });

    const itemC = makeItem({
      id: "cal:c",
      title: "Item C",
      signals: {
        urgency: 0.5,
        actionability: 0.6,
        novelty: null,
        confidence: 0.7,
        importance: null,
        interruptibility: null,
      },
      dueAt: NOW + 1500000,
    });

    const result = rankAttention([itemA, itemB, itemC], {
      now: NOW,
      hourOfDay: 10,
      quietHours: null,
      focusActive: false,
    });

    // All three should be in later (scores < 0.6) or now (if >= 0.6).
    // Let's check the combined ordering of now + later.
    const all = [...result.now, ...result.later];

    // Verify descending score order
    for (let i = 1; i < all.length; i++) {
      if (all[i - 1].score !== null && all[i].score !== null) {
        strictEqual(
          all[i - 1].score >= all[i].score,
          true,
          `scores not descending at index ${i}`
        );
      }
    }

    // Now test tie-breaking: same score, different dueAt
    const sameScoreA = makeItem({
      id: "cal:tie1",
      title: "Tie A",
      signals: {
        urgency: 0.4,
        actionability: 0.5,
        novelty: null,
        confidence: 0.6,
        importance: null,
        interruptibility: null,
      },
      dueAt: NOW + 3000000,
    });

    const sameScoreB = makeItem({
      id: "cal:tie2",
      title: "Tie B",
      signals: {
        urgency: 0.4,
        actionability: 0.5,
        novelty: null,
        confidence: 0.6,
        importance: null,
        interruptibility: null,
      },
      dueAt: NOW + 1000000,
    });

    const sameScoreC = makeItem({
      id: "cal:tie3",
      title: "Tie C",
      signals: {
        urgency: 0.4,
        actionability: 0.5,
        novelty: null,
        confidence: 0.6,
        importance: null,
        interruptibility: null,
      },
      dueAt: NOW + 1000000, // same dueAt as tie2
    });

    const result2 = rankAttention([sameScoreA, sameScoreB, sameScoreC], {
      now: NOW,
      hourOfDay: 10,
      quietHours: null,
      focusActive: false,
    });

    const all2 = [...result2.now, ...result2.later];

    // tie2 and tie3 have same score and same dueAt → ordered by id
    // tie2 (dueAt 1M) should come before tie1 (dueAt 3M) because dueAt ascending
    // Among tie2 and tie3: id "cal:tie2" < "cal:tie3"
    strictEqual(all2[0].id, "cal:tie2");
    strictEqual(all2[1].id, "cal:tie3");
    strictEqual(all2[2].id, "cal:tie1");
  });
});
