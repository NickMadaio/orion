import { strictEqual, deepStrictEqual } from "node:assert/strict";
import { describe, it, after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { summarizeAutomationHistory, SUPPRESSION_REASONS } from "../scripts/lib/orion-automation-history-summary.mjs";

const FROM = Date.parse("2026-09-26T00:00:00Z");
const WINDOW_DAYS = 7;

function entry(at, status, reason, delivery) {
  return { v: 1, at, name: "test-auto", status, reason, delivery, recordedAt: at + 1 };
}

describe("hist-summary", () => {
  let tmpRoot;
  after(async () => { if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true }); });

  it("counts firings, suppressions, refusals and deliveries in the window", async () => {
    const mid = FROM - 3 * 86400000;
    const entries = [
      entry(mid, "succeeded", null, "delivered"),
      entry(mid + 1000, "failed", null, null),
      entry(mid + 2000, "outcome_unknown", null, null),
      entry(mid + 3000, "refused", "quiet_hours", null),
      entry(mid + 4000, "refused", "focus_active", null),
      entry(mid + 5000, "refused", "duplicate_or_old_trigger", null),
      entry(mid + 6000, "succeeded", null, "withheld"),
    ];

    const result = summarizeAutomationHistory(entries, { from: FROM, windowDays: WINDOW_DAYS });

    strictEqual(result.firings, 4);
    strictEqual(result.succeeded, 2);
    strictEqual(result.failed, 1);
    strictEqual(result.unknown, 1);
    strictEqual(result.suppressed, 2);
    strictEqual(result.refused, 1);
    strictEqual(result.delivered, 1);
    strictEqual(result.withheld, 1);
    strictEqual(result.byReason.quiet_hours, 1);
  });

  it("ignores entries outside the half-open window", async () => {
    const windowStart = FROM - WINDOW_DAYS * 86400000;
    const entries = [
      entry(FROM, "succeeded", null, null),
      entry(windowStart, "succeeded", null, null),
      entry(windowStart - 1, "succeeded", null, null),
    ];

    const result = summarizeAutomationHistory(entries, { from: FROM, windowDays: WINDOW_DAYS });
    strictEqual(result.entries, 1);
  });

  it("counts observed days by UTC date", async () => {
    const day24 = Date.parse("2026-09-24T10:00:00Z");
    const day25 = Date.parse("2026-09-25T10:00:00Z");
    const entries = [
      entry(day24, "succeeded", null, null),
      entry(day24 + 3600000, "succeeded", null, null),
      entry(day25, "succeeded", null, null),
    ];

    const result = summarizeAutomationHistory(entries, { from: FROM, windowDays: WINDOW_DAYS });
    strictEqual(result.observedDays, 2);
    strictEqual(result.perDay["2026-09-24"].firings, 2);
  });

  it("rejects invalid options with a TypeError", async () => {
    const opts = { from: FROM, windowDays: WINDOW_DAYS };

    // entries not array
    try { summarizeAutomationHistory("x", opts); } catch (e) { strictEqual(e.constructor, TypeError); }

    // from negative
    try { summarizeAutomationHistory([], { ...opts, from: -1 }); } catch (e) { strictEqual(e.constructor, TypeError); }

    // windowDays 0
    try { summarizeAutomationHistory([], { ...opts, windowDays: 0 }); } catch (e) { strictEqual(e.constructor, TypeError); }

    // windowDays 367
    try { summarizeAutomationHistory([], { ...opts, windowDays: 367 }); } catch (e) { strictEqual(e.constructor, TypeError); }

    // windowDays 2.5
    try { summarizeAutomationHistory([], { ...opts, windowDays: 2.5 }); } catch (e) { strictEqual(e.constructor, TypeError); }
  });

  it("does not mutate its input", async () => {
    const mid = FROM - 3 * 86400000;
    const entries = [entry(mid, "succeeded", null, "delivered")];
    Object.freeze(entries);
    entries.forEach(e => Object.freeze(e));

    const before = JSON.stringify(entries);
    summarizeAutomationHistory(entries, { from: FROM, windowDays: WINDOW_DAYS });
    strictEqual(JSON.stringify(entries), before);
  });

  it("empty input gives zero counts and no observed days", async () => {
    const result = summarizeAutomationHistory([], { from: FROM, windowDays: WINDOW_DAYS });

    strictEqual(result.firings, 0);
    strictEqual(result.suppressed, 0);
    strictEqual(result.refused, 0);
    strictEqual(result.succeeded, 0);
    strictEqual(result.failed, 0);
    strictEqual(result.unknown, 0);
    strictEqual(result.delivered, 0);
    strictEqual(result.withheld, 0);
    strictEqual(result.observedDays, 0);
    deepStrictEqual(result.byReason, {});
    deepStrictEqual(result.perDay, {});
  });
});
