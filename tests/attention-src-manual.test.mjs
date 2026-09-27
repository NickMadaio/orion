import { strictEqual, throws } from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { parseManualAttention } from "../scripts/lib/attention/sources/manual.mjs";

const NOW = 1790000000000;

describe("manual attention source", () => {
  it("a bare title makes a reminder", () => {
    const item = parseManualAttention(["Buy milk"], { now: NOW });

    strictEqual(item.source, "manual");
    strictEqual(item.kind, "reminder");
    strictEqual(item.title, "Buy milk");
    strictEqual(item.detail, "");
    strictEqual(item.observedAt, NOW);
    strictEqual(item.dueAt, null);
    strictEqual(item.expiresAt, null);
    strictEqual(item.signals.urgency, null);
    strictEqual(item.signals.importance, null);
    strictEqual(item.signals.actionability, 0.8);
    strictEqual(item.signals.confidence, 1);
    strictEqual(item.signals.novelty, null);
    strictEqual(item.signals.interruptibility, null);

    // id depends on title + now
    const expectedId = "manual:" +
      createHash("sha256")
        .update(`Buy milk|${NOW}`)
        .digest("hex").slice(0, 12);
    strictEqual(item.id, expectedId);

    // dedupKey depends on title only
    strictEqual(item.dedupKey, "manual:buy-milk");
  });

  it("flags set due, expiry, urgency and importance", () => {
    const item = parseManualAttention(
      [
        "Call dentist",
        "--due", "2025-06-15T09:00:00Z",
        "--expires", "2025-06-16T09:00:00Z",
        "--urgency", "0.7",
        "--importance", "0.5",
      ],
      { now: NOW }
    );

    strictEqual(item.title, "Call dentist");
    strictEqual(item.dueAt, Date.parse("2025-06-15T09:00:00Z"));
    strictEqual(item.expiresAt, Date.parse("2025-06-16T09:00:00Z"));
    strictEqual(item.signals.urgency, 0.7);
    strictEqual(item.signals.importance, 0.5);
  });

  it("each bad flag is named", () => {
    // --due with non-date value
    throws(
      () => parseManualAttention(["title", "--due", "nope"], { now: NOW }),
      (err) => {
        strictEqual(err instanceof TypeError, true);
        strictEqual(err.message, "--due must be a date");
        return true;
      }
    );

    // --urgency out of range
    throws(
      () => parseManualAttention(["title", "--urgency", "2"], { now: NOW }),
      (err) => {
        strictEqual(err instanceof TypeError, true);
        strictEqual(err.message, "--urgency must be between 0 and 1");
        return true;
      }
    );

    // unknown flag
    throws(
      () => parseManualAttention(["title", "--colour", "red"], { now: NOW }),
      (err) => {
        strictEqual(err instanceof TypeError, true);
        strictEqual(err.message, "unknown flag --colour");
        return true;
      }
    );

    // trailing --due with no value
    throws(
      () => parseManualAttention(["title", "--due"], { now: NOW }),
      (err) => {
        strictEqual(err instanceof TypeError, true);
        strictEqual(err.message, "--due needs a value");
        return true;
      }
    );
  });

  it("the same title shares a dedupKey", () => {
    const item1 = parseManualAttention(["Buy milk"], { now: NOW });
    const item2 = parseManualAttention(["Buy milk"], { now: NOW + 60000 });

    strictEqual(item1.dedupKey, item2.dedupKey);
    strictEqual(item1.id !== item2.id, true);
  });
});
