// w20 routegate: every bedtime reader goes through effective-bed.mjs, so a tonight-only bedtime moves the nudge and the quiet window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveBedtime, withEffectiveBed } from "../scripts/lib/life/effective-bed.mjs";
import { nudgeInstant } from "../scripts/lib/reach/night-hush.mjs";
import { sleepWindowFor } from "../scripts/lib/reach/quiet.mjs";

const base = { bedtime: "00:00", usualWake: "09:00", windDownMinutes: 30 };
const withOverride = { ...base, sleepPlan: { bedOverrides: { "2026-11-04": "23:00" } } };
const NOW = new Date(2026, 10, 4, 21, 0);   // evening of 2026-11-04

test("effectiveBedtime: the named night wins, other nights keep the standing bedtime", () => {
  assert.equal(effectiveBedtime(withOverride, "2026-11-04"), "23:00");
  assert.equal(effectiveBedtime(withOverride, "2026-11-05"), "00:00");
  assert.equal(withEffectiveBed(withOverride, "2026-11-04").bedtime, "23:00");
});

test("a tonight override shifts the bedtime nudge (wind-down) by the same amount", () => {
  const plain = nudgeInstant({ now: NOW, plan: null, config: base });
  const moved = nudgeInstant({ now: NOW, plan: null, config: withOverride });
  assert.equal(plain.getHours() * 60 + plain.getMinutes(), 23 * 60 + 30);
  assert.equal(moved.getHours() * 60 + moved.getMinutes(), 22 * 60 + 30);
});

test("the quiet window opens at the overridden bedtime for that night only", () => {
  assert.equal(sleepWindowFor({ date: "2026-11-04", config: withOverride }).bed, 23 * 60);
  assert.equal(sleepWindowFor({ date: "2026-11-05", config: withOverride }).bed, 1440);
});
