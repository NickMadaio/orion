import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "orion-life-"));
process.env.ORION_LIFE_HISTORY = join(dir, "history.jsonl");
process.env.ORION_PATTERNS_FILE = join(dir, "patterns.json");
const { recordOutcome, summarize, loadPatterns, lateHabit } = await import("../scripts/lib/life/history.mjs");
test.after(() => rmSync(dir, { recursive: true, force: true }));

const at = (h, m) => new Date(2026, 8, 29, h, m).getTime();
test("outcomes become patterns once there are three", () => {
  recordOutcome({ what: "study for macro", plannedAt: at(15, 0), actualAt: at(15, 20) });
  recordOutcome({ what: "study for marketing", plannedAt: at(16, 0), actualAt: at(16, 25) });
  assert.equal(lateHabit(summarize({}), "study"), null, "two samples say nothing yet");
  recordOutcome({ what: "study notes", plannedAt: at(17, 0), actualAt: at(17, 20) });
  const p = summarize({});
  assert.equal(p.byKind.study.medianDelay, 20);
  assert.match(lateHabit(p, "study"), /about 20 min late/);
});
test("skipped starts lower the rate", () => {
  recordOutcome({ what: "gym", plannedAt: at(18, 0), actualAt: null });
  recordOutcome({ what: "gym", plannedAt: at(18, 0), actualAt: at(18, 5) });
  recordOutcome({ what: "gym", plannedAt: at(18, 0), actualAt: null });
  assert.equal(summarize({}).byKind.gym.rate, 0.33);
});
test("sleep and wake come from the health log", () => {
  const p = summarize({ sleepLog: [0, 1, 2].map((i) => ({ event: "bed", at: new Date(2026, 8, 20 + i, 1, 30).toISOString() }))
    .concat([0, 1, 2].map((i) => ({ event: "up", at: new Date(2026, 8, 20 + i, 9, 30).toISOString() }))) });
  assert.equal(p.sleep.median, 90); assert.equal(p.wake.median, 570);
  assert.equal(loadPatterns().wake.median, 570);
});
