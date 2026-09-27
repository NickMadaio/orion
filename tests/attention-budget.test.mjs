import { test } from "node:test";
import assert from "node:assert/strict";
import { canInterrupt, recordInterruption } from "../scripts/lib/attention/budget.mjs";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

test("an empty ledger allows", () => {
  const now = 1_700_000_000_000;
  const result = canInterrupt([], now);
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "ok");
  assert.equal(result.nextAt, null);
});

test("the hour limit blocks and says when it clears", () => {
  const now = 1_700_000_000_000;
  // Two interruptions within the last hour (default maxPerHour = 2)
  const ledger = [now - 60_000, now - 30_000];

  const result = canInterrupt(ledger, now);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "hour_limit");
  // nextAt is when the oldest one ages out of the hour window
  assert.equal(result.nextAt, (now - 60_000) + HOUR_MS);
});

test("the day limit blocks after the hour window has passed", () => {
  const now = 1_700_000_000_000;
  // 8 interruptions spread across the day but fewer than 2 in any single hour
  // Place them so that no two are within the same hour window
  const ledger = [];
  for (let i = 0; i < 8; i++) {
    // Each entry is 1 hour + 1 second apart, so they never share an hour window
    ledger.push(now - (i * (HOUR_MS + 1_000)));
  }

  const result = canInterrupt(ledger, now);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "day_limit");
  // nextAt is when the oldest one ages out of the day window
  assert.equal(result.nextAt, ledger[7] + DAY_MS);
});

test("recording keeps only the last day and never mutates", () => {
  const now = 1_700_000_000_000;
  // Include entries older than 24 hours and some within range
  const oldEntry = now - DAY_MS - 1_000; // outside window
  const recentEntry = now - 3_600_000;   // inside window

  const input = Object.freeze([oldEntry, recentEntry]);

  const result = recordInterruption(input, now);

  // Old entry is dropped
  assert.ok(!result.includes(oldEntry));
  // Recent entry and new timestamp are present
  assert.ok(result.includes(recentEntry));
  assert.ok(result.includes(now));
  // Sorted ascending
  assert.equal(result[0], recentEntry);
  assert.equal(result[result.length - 1], now);
  // Input not mutated (frozen, so would throw if attempted)
  assert.deepEqual(input, [oldEntry, recentEntry]);
});
