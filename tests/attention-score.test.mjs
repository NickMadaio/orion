import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_WEIGHTS, scoreAttentionItem } from "../scripts/lib/attention/score.mjs";

test("all six known is the weighted mean", () => {
  // all signals 0.5 -> 0.5
  const itemHalf = {
    id: "t:1",
    source: "manual",
    kind: "test",
    title: "Test",
    detail: "",
    observedAt: 0,
    dueAt: null,
    expiresAt: null,
    dedupKey: "t:1",
    signals: {
      urgency: 0.5,
      importance: 0.5,
      actionability: 0.5,
      confidence: 0.5,
      novelty: 0.5,
      interruptibility: 0.5,
    },
  };

  const resultHalf = scoreAttentionItem(itemHalf);
  assert.equal(resultHalf.score, 0.5);

  // urgency 1 and others 0 -> 0.3
  const itemUrgent = {
    id: "t:2",
    source: "manual",
    kind: "test",
    title: "Test",
    detail: "",
    observedAt: 0,
    dueAt: null,
    expiresAt: null,
    dedupKey: "t:2",
    signals: {
      urgency: 1,
      importance: 0,
      actionability: 0,
      confidence: 0,
      novelty: 0,
      interruptibility: 0,
    },
  };

  const resultUrgent = scoreAttentionItem(itemUrgent);
  assert.equal(resultUrgent.score, 0.3);
});

test("unknown signals are left out, not counted as zero", () => {
  // urgency 1, importance 1, confidence 1, others null -> 1 (not 0.65)
  const item = {
    id: "t:3",
    source: "manual",
    kind: "test",
    title: "Test",
    detail: "",
    observedAt: 0,
    dueAt: null,
    expiresAt: null,
    dedupKey: "t:3",
    signals: {
      urgency: 1,
      importance: 1,
      actionability: null,
      confidence: 1,
      novelty: null,
      interruptibility: null,
    },
  };

  const result = scoreAttentionItem(item);
  assert.equal(result.score, 1);
});

test("too few known signals cannot be ranked", () => {
  // two known -> score null, known length 2
  const item = {
    id: "t:4",
    source: "manual",
    kind: "test",
    title: "Test",
    detail: "",
    observedAt: 0,
    dueAt: null,
    expiresAt: null,
    dedupKey: "t:4",
    signals: {
      urgency: 0.8,
      importance: 0.6,
      actionability: null,
      confidence: null,
      novelty: null,
      interruptibility: null,
    },
  };

  const result = scoreAttentionItem(item);
  assert.equal(result.score, null);
  assert.equal(result.known.length, 2);
});

test("known and unknown are reported in weight order", () => {
  // urgency and novelty null -> unknown ["urgency", "novelty"]
  const item = {
    id: "t:5",
    source: "manual",
    kind: "test",
    title: "Test",
    detail: "",
    observedAt: 0,
    dueAt: null,
    expiresAt: null,
    dedupKey: "t:5",
    signals: {
      urgency: null,
      importance: 0.5,
      actionability: 0.5,
      confidence: 0.5,
      novelty: null,
      interruptibility: 0.5,
    },
  };

  const result = scoreAttentionItem(item);
  assert.deepStrictEqual(result.unknown, ["urgency", "novelty"]);
});

test("custom weights are honoured", () => {
  // weights {urgency: 1, importance: 0, actionability: 0, confidence: 0, novelty: 0, interruptibility: 0}
  // with urgency 0.7 and two others known -> 0.7
  const customWeights = {
    urgency: 1,
    importance: 0,
    actionability: 0,
    confidence: 0,
    novelty: 0,
    interruptibility: 0,
  };

  const item = {
    id: "t:6",
    source: "manual",
    kind: "test",
    title: "Test",
    detail: "",
    observedAt: 0,
    dueAt: null,
    expiresAt: null,
    dedupKey: "t:6",
    signals: {
      urgency: 0.7,
      importance: 0.5,
      actionability: 0.3,
      confidence: null,
      novelty: null,
      interruptibility: null,
    },
  };

  const result = scoreAttentionItem(item, customWeights);
  assert.equal(result.score, 0.7);
});
