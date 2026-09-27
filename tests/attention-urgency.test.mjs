import { test } from "node:test";
import { strict as assert } from "node:assert/strict";
import { urgencyFromDue } from "../scripts/lib/attention/urgency.mjs";

const NOW = 1_700_000_000_000; // fixed clock

test("no due time is unknown, not zero", () => {
  assert.strictEqual(urgencyFromDue(null, NOW), null);
});

test("overdue and due now are fully urgent", () => {
  // overdue by 1 ms
  assert.strictEqual(urgencyFromDue(NOW - 1, NOW), 1);
  // exactly due now
  assert.strictEqual(urgencyFromDue(NOW, NOW), 1);
});

test("each step of the table", () => {
  // Strictly inside each band
  const oneHourLater = NOW + 3_600_000;
  const sixHoursLater = NOW + 6 * 3_600_000;
  const twentyFourHoursLater = NOW + 24 * 3_600_000;
  const seventyTwoHoursLater = NOW + 72 * 3_600_000;
  const oneSixtyEightHoursLater = NOW + 168 * 3_600_000;

  // Inside (0, 1] band: e.g., 30 min
  assert.strictEqual(urgencyFromDue(NOW + 1_800_000, NOW), 0.95);

  // Exactly 1h boundary -> 0.95
  assert.strictEqual(urgencyFromDue(oneHourLater, NOW), 0.95);

  // Inside (1, 6] band: e.g., 3h
  assert.strictEqual(urgencyFromDue(NOW + 3 * 3_600_000, NOW), 0.8);

  // Exactly 6h boundary -> 0.8
  assert.strictEqual(urgencyFromDue(sixHoursLater, NOW), 0.8);

  // Inside (6, 24] band: e.g., 12h
  assert.strictEqual(urgencyFromDue(NOW + 12 * 3_600_000, NOW), 0.6);

  // Exactly 24h boundary -> 0.6
  assert.strictEqual(urgencyFromDue(twentyFourHoursLater, NOW), 0.6);

  // Inside (24, 72] band: e.g., 48h
  assert.strictEqual(urgencyFromDue(NOW + 48 * 3_600_000, NOW), 0.4);

  // Exactly 72h boundary -> 0.4
  assert.strictEqual(urgencyFromDue(seventyTwoHoursLater, NOW), 0.4);

  // Inside (72, 168] band: e.g., 100h
  assert.strictEqual(urgencyFromDue(NOW + 100 * 3_600_000, NOW), 0.25);

  // Exactly 168h boundary -> 0.25
  assert.strictEqual(urgencyFromDue(oneSixtyEightHoursLater, NOW), 0.25);

  // Beyond 168h: e.g., 200h
  assert.strictEqual(urgencyFromDue(NOW + 200 * 3_600_000, NOW), 0.1);
});

test("bad input throws", () => {
  // now is not a safe integer (float)
  assert.throws(
    () => urgencyFromDue(NOW, 1.5),
    TypeError
  );

  // dueAt is not a safe integer and not null (string)
  assert.throws(
    () => urgencyFromDue("soon", NOW),
    TypeError
  );
});
