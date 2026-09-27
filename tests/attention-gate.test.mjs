import { strictEqual, deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { attentionGate } from "../scripts/lib/attention/gate.mjs";

function makeItem(overrides = {}) {
  return {
    id: "test:001",
    source: "manual",
    kind: "test",
    title: "Test item",
    detail: "",
    observedAt: 1790000000000,
    dueAt: null,
    expiresAt: null,
    dedupKey: "test:001",
    signals: {
      urgency: 0.5,
      actionability: 0.5,
      novelty: null,
      confidence: 0.5,
      importance: null,
      interruptibility: null,
    },
    ...overrides,
  };
}

function makeContext(overrides = {}) {
  return {
    now: 1790000000000,
    hourOfDay: 12,
    quietHours: null,
    focusActive: false,
    score: 0.5,
    ...overrides,
  };
}

describe("attention gate", () => {
  it("an expired item is dropped", () => {
    const item = makeItem({ expiresAt: 1790000000000 });
    const ctx = makeContext();
    const result = attentionGate(item, ctx);
    strictEqual(result.route, "drop");
    strictEqual(result.reason, "expired");
    strictEqual(result.deliver, false);
  });

  it("an unranked item is filed, never interrupts", () => {
    const item = makeItem({ signals: { ...makeItem().signals, urgency: 1 } });
    const ctx = makeContext({ score: null });
    const result = attentionGate(item, ctx);
    strictEqual(result.route, "today");
    strictEqual(result.reason, "unranked");
    strictEqual(result.deliver, false);
  });

  it("quiet hours wrap midnight", () => {
    // Quiet [22, 7]: hour 23 -> quiet_hours; hour 3 -> quiet_hours; hour 12 -> not quiet
    const baseItem = makeItem({ signals: { ...makeItem().signals, urgency: 0.5 } });

    // Hour 23 — inside quiet window
    let ctx = makeContext({ hourOfDay: 23, quietHours: [22, 7], focusActive: false, score: 0.9 });
    let result = attentionGate(baseItem, ctx);
    strictEqual(result.route, "today");
    strictEqual(result.reason, "quiet_hours");

    // Hour 3 — inside wrapped quiet window
    ctx = makeContext({ hourOfDay: 3, quietHours: [22, 7], focusActive: false, score: 0.9 });
    result = attentionGate(baseItem, ctx);
    strictEqual(result.route, "today");
    strictEqual(result.reason, "quiet_hours");

    // Hour 12 — not in quiet window, focus false, score 0.9 -> interrupt
    ctx = makeContext({ hourOfDay: 12, quietHours: [22, 7], focusActive: false, score: 0.9 });
    result = attentionGate(baseItem, ctx);
    strictEqual(result.route, "interrupt");
    strictEqual(result.reason, "score");
  });

  it("very urgent items pass quiet hours and focus", () => {
    const item = makeItem({ signals: { ...makeItem().signals, urgency: 0.95 } });
    const ctx = makeContext({ hourOfDay: 23, quietHours: [22, 7], focusActive: true, score: 0.8 });
    const result = attentionGate(item, ctx);
    strictEqual(result.route, "interrupt");
    strictEqual(result.reason, "score");
    strictEqual(result.deliver, true);
  });

  it("unknown focus counts as focus", () => {
    const item = makeItem({ signals: { ...makeItem().signals, urgency: 0.5 } });
    const ctx = makeContext({ focusActive: null, score: 0.9 });
    const result = attentionGate(item, ctx);
    strictEqual(result.route, "today");
    strictEqual(result.reason, "focus_unknown");
    strictEqual(result.deliver, false);
  });

  it("score decides the rest", () => {
    // No quiet, focus false: score 0.6 -> interrupt; 0.59 -> today low_score
    const item = makeItem({ signals: { ...makeItem().signals, urgency: 0.5 } });

    let ctx = makeContext({ quietHours: null, focusActive: false, score: 0.6 });
    let result = attentionGate(item, ctx);
    strictEqual(result.route, "interrupt");
    strictEqual(result.reason, "score");

    ctx = makeContext({ quietHours: null, focusActive: false, score: 0.59 });
    result = attentionGate(item, ctx);
    strictEqual(result.route, "today");
    strictEqual(result.reason, "low_score");
  });

  it("deliver matches route", () => {
    // Verify deliver === (route === "interrupt") for every scenario above
    const cases = [
      // expired -> drop
      { item: makeItem({ expiresAt: 1790000000000 }), ctx: makeContext() },
      // unranked -> today
      { item: makeItem({ signals: { ...makeItem().signals, urgency: 1 } }), ctx: makeContext({ score: null }) },
      // quiet_hours -> today
      { item: makeItem({ signals: { ...makeItem().signals, urgency: 0.5 } }), ctx: makeContext({ hourOfDay: 23, quietHours: [22, 7], focusActive: false, score: 0.9 }) },
      // interrupt via score (urgent passes quiet+focus)
      { item: makeItem({ signals: { ...makeItem().signals, urgency: 0.95 } }), ctx: makeContext({ hourOfDay: 23, quietHours: [22, 7], focusActive: true, score: 0.8 }) },
      // focus_unknown -> today
      { item: makeItem({ signals: { ...makeItem().signals, urgency: 0.5 } }), ctx: makeContext({ focusActive: null, score: 0.9 }) },
      // interrupt via score >= 0.6
      { item: makeItem({ signals: { ...makeItem().signals, urgency: 0.5 } }), ctx: makeContext({ quietHours: null, focusActive: false, score: 0.6 }) },
      // low_score -> today
      { item: makeItem({ signals: { ...makeItem().signals, urgency: 0.5 } }), ctx: makeContext({ quietHours: null, focusActive: false, score: 0.59 }) },
    ];

    for (const { item, ctx } of cases) {
      const result = attentionGate(item, ctx);
      strictEqual(result.deliver, result.route === "interrupt", `deliver mismatch for route=${result.route} reason=${result.reason}`);
    }
  });
});
