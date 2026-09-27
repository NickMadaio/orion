import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAttentionItem, normalizeAttentionItem, ATTENTION_SOURCES, ATTENTION_SIGNALS } from "../scripts/lib/attention/item.mjs";

const GOOD_ITEM = {
  id: "calendar:ab12cd34ef56",
  source: "calendar",
  kind: "starting_soon",
  title: "Seminar starts in 20 min",
  detail: "",
  observedAt: 1790000000000,
  dueAt: 1790001200000,
  expiresAt: null,
  dedupKey: "calendar:ab12cd34ef56",
  signals: { urgency: 0.8, actionability: 0.7, novelty: null, confidence: 0.9, importance: null, interruptibility: null },
};

describe("attention item shape and validation", async () => {
  let tmp;
  await mkdtemp(join(tmpdir(), "orion-att-")).then(p => { tmp = p; });
  after(async () => {
    // cleanup not strictly needed for pure tests but matches pattern
  });

  it("a well-formed item is valid", () => {
    const result = validateAttentionItem(GOOD_ITEM);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  });

  it("each invalid field is named", () => {
    // bad id
    let r = validateAttentionItem({ ...GOOD_ITEM, id: "BAD ID!" });
    assert.ok(r.errors.some(e => e.startsWith("id:")), "id error missing: " + JSON.stringify(r.errors));

    // bad source
    r = validateAttentionItem({ ...GOOD_ITEM, source: "email" });
    assert.ok(r.errors.some(e => e.startsWith("source:")), "source error missing");

    // bad kind
    r = validateAttentionItem({ ...GOOD_ITEM, kind: "Bad Kind!" });
    assert.ok(r.errors.some(e => e.startsWith("kind:")), "kind error missing");

    // bad title (empty after trim)
    r = validateAttentionItem({ ...GOOD_ITEM, title: "   " });
    assert.ok(r.errors.some(e => e.startsWith("title:")), "title error missing");

    // bad observedAt
    r = validateAttentionItem({ ...GOOD_ITEM, observedAt: -1 });
    assert.ok(r.errors.some(e => e.startsWith("observedAt:")), "observedAt error missing");

    // bad dueAt
    r = validateAttentionItem({ ...GOOD_ITEM, dueAt: "not a number" });
    assert.ok(r.errors.some(e => e.startsWith("dueAt:")), "dueAt error missing");

    // bad dedupKey
    r = validateAttentionItem({ ...GOOD_ITEM, dedupKey: "" });
    assert.ok(r.errors.some(e => e.startsWith("dedupKey:")), "dedupKey error missing");

    // bad signal value (urgency 1.5)
    r = validateAttentionItem({ ...GOOD_ITEM, signals: { ...GOOD_ITEM.signals, urgency: 1.5 } });
    assert.ok(r.errors.some(e => e.startsWith("signals.urgency:")), "signals.urgency error missing");

    // missing signal key
    const sigCopy = { ...GOOD_ITEM.signals };
    delete sigCopy.novelty;
    r = validateAttentionItem({ ...GOOD_ITEM, signals: sigCopy });
    assert.ok(r.errors.some(e => e.startsWith("signals:")), "signals key-set error missing");

    // extra field
    r = validateAttentionItem({ ...GOOD_ITEM, extraField: true });
    assert.ok(r.errors.some(e => e.startsWith("extraField:")), "extra field error missing");
  });

  it("normalize trims and clamps without mutating", () => {
    const original = {
      ...GOOD_ITEM,
      title: "  Hi  ",
      detail: "  some detail  ",
      signals: {
        urgency: 1.4,
        actionability: 0.5,
        novelty: null,
        confidence: -0.3,
        importance: -0.2,
        interruptibility: 0.9,
      },
    };
    const copy = JSON.parse(JSON.stringify(original));

    const result = normalizeAttentionItem(original);

    // Check trimming
    assert.equal(result.title, "Hi");
    assert.equal(result.detail, "some detail");

    // Check clamping
    assert.equal(result.signals.urgency, 1);
    assert.equal(result.signals.confidence, 0);
    assert.equal(result.signals.importance, 0);
    assert.equal(result.signals.novelty, null);

    // Check no mutation
    assert.deepEqual(original, copy);
  });

  it("normalize throws on what cannot be fixed", () => {
    const bad = { ...GOOD_ITEM, source: "email" };
    assert.throws(() => normalizeAttentionItem(bad), TypeError);
  });

  it("a non-object is rejected", () => {
    let r = validateAttentionItem(null);
    assert.equal(r.ok, false);

    r = validateAttentionItem("x");
    assert.equal(r.ok, false);
  });
});
