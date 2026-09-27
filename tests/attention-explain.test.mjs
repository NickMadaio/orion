import { strictEqual, deepStrictEqual } from "node:assert";
import { describe, it } from "node:test";
import { explainAttention } from "../scripts/lib/attention/explain.mjs";

describe("explainAttention", () => {
  const baseItem = {
    id: "test:01",
    source: "manual",
    kind: "test",
    title: "Test item",
    detail: "",
    observedAt: 1790000000000,
    dueAt: null,
    expiresAt: null,
    dedupKey: "test:01",
    signals: {
      urgency: 0.5,
      actionability: 0.5,
      novelty: 0.5,
      confidence: 0.5,
      importance: 0.5,
      interruptibility: 0.5,
    },
  };

  const allKnown = {
    score: 0.7,
    known: ["urgency", "actionability", "novelty", "confidence", "importance", "interruptibility"],
    unknown: [],
  };

  it("each reason has its sentence", () => {
    const reasons = [
      { reason: "expired", route: "drop", expected: "Dropped: it expired." },
      { reason: "unranked", route: "today", expected: "Filed for later: too little is known to rank it." },
      { reason: "quiet_hours", route: "today", expected: "Held for later: it is quiet hours and this is not urgent enough to break them." },
      { reason: "focus_active", route: "today", expected: "Held for later: you are focusing and this can wait." },
      { reason: "focus_unknown", route: "today", expected: "Held for later: it is not known whether you are focusing, so it waits." },
      { reason: "score", route: "interrupt", expected: "Shown now: it scored high enough to interrupt." },
      { reason: "low_score", route: "today", expected: "Filed for later: worth knowing, not worth interrupting for." },
    ];

    for (const { reason, route, expected } of reasons) {
      const gated = { route, reason };
      const scored = allKnown;
      const sentences = explainAttention(baseItem, scored, gated);
      strictEqual(sentences[0], expected, `reason "${reason}" should produce correct first sentence`);
    }

    // Also test the fallback for an unknown reason
    const fallbackGated = { route: "custom", reason: "some_new_reason" };
    const fallbackSentences = explainAttention(baseItem, allKnown, fallbackGated);
    strictEqual(fallbackSentences[0], "Routed to custom: some_new_reason.");
  });

  it("a ranked item states its score and signals", () => {
    const gated = { route: "interrupt", reason: "score" };
    const scored = allKnown;
    const sentences = explainAttention(baseItem, scored, gated);

    strictEqual(sentences[0], "Shown now: it scored high enough to interrupt.");
    strictEqual(sentences[1], "Scored 0.7 from 6 of 6 signals.");
    // No unknowns, so only two sentences
    strictEqual(sentences.length, 2);
  });

  it("an unranked item says how little is known and names the unknowns", () => {
    const gated = { route: "today", reason: "unranked" };
    const scored = {
      score: null,
      known: ["urgency", "actionability"],
      unknown: ["novelty", "confidence", "importance", "interruptibility"],
    };
    const sentences = explainAttention(baseItem, scored, gated);

    strictEqual(sentences[0], "Filed for later: too little is known to rank it.");
    strictEqual(sentences[1], "Only 2 of 6 signals are known.");
    strictEqual(sentences[2], "Unknown: novelty, confidence, importance, interruptibility.");
    strictEqual(sentences.length, 3);
  });
});
