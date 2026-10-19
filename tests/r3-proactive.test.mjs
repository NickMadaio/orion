// Round 3: inbound-turn returns fast and declares first; the bedtime phrase lists; who may ask for the protected tier.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isBedtimeStatement, activeDeclaration } from "../scripts/lib/awareness/declared.mjs";
import { tierOf, mayBeProtected } from "../scripts/lib/reach/budget.mjs";
import { world, at } from "./incident-world.mjs";

const TRUE = ["going to bed now", "goodnight orion", "im heading to sleep", "night, going to bed", "gonna head to bed", "time to sleep", "night!", "sleeping now", "bedtime", "off to bed", "heading to bed", "going to sleep now", "gn"];
const FALSE = ["just turning in my essay", "my roommate is going to bed so ill be quiet", "had a good night out with sam", "going to sleep for 20 min", "heading to bed after this episode",
  "good night out", "going to bed early tomorrow", "going to sleep at 2", "going to sleep on it", "sleep on it", "bedtime is at 1 tonight", "what time should I go to bed"];

test("4: immediate first-person bedtime phrases declare; futures, times, idioms and questions do not", () => {
  for (const t of TRUE) assert.equal(isBedtimeStatement(t), true, t);
  for (const t of FALSE) assert.equal(isBedtimeStatement(t), false, t);
});

test("1: with a slow review the declaration is written and orion-inbound-turn returns in under 1 s (the review runs detached)", () => {
  const w = world({ day: 18 });
  const slow = w.bin("slow-review", `sleep 8; echo "Sent - slow" `);
  const t0 = Date.now();
  const r = w.run("orion-inbound-turn", ["--text", "going to bed now"], 21, 50, { extra: { ORION_DAY_REVIEW_BIN: slow } });
  const took = Date.now() - t0;
  assert.equal(r.status, 0, r.stderr);
  assert.ok(took < 1000, `returned in ${took} ms`);
  assert.ok(activeDeclaration({ dir: w.dir, now: at(18, 21, 55) }), "the declaration was written first");
});

test("1: the detached review is exempt from the declaration's own hold, and only the review may be", () => {
  const w = world({ day: 18, awOver: { sleep: { state: "asleep" } } });
  const review = ["Today: nothing.", "--kind", "update", "--why", "curiosity: review-2026-10-18", "--no-queue", "--channel", "phone"];
  assert.equal(w.run("orion-reach", review, 21, 52, { over: { sleep: { state: "asleep" } } }).status, 0, "held: nothing delivered");
  assert.equal(w.outreach().at(-1).channel, "hold");
  const ok = w.run("orion-reach", [...review, "--gate-exempt"], 21, 53, { over: { sleep: { state: "asleep" } } });
  assert.match(ok.stdout, /^Sent/);
  const other = w.run("orion-reach", ["spam", "--kind", "info", "--why", "proactive: spam", "--gate-exempt"], 21, 54, { over: { sleep: { state: "asleep" } } });
  assert.doesNotMatch(other.stdout, /^Sent/, "a forged exemption holds like any other message");
});

test("5: protected comes from the why, not the kind: a plain --kind reminder --tier protected is an ordinary message", () => {
  assert.equal(tierOf({ why: "proactive: spam", kind: "reminder", tier: "protected" }), "normal");
  assert.equal(tierOf({ why: "unanswered spoken question", kind: "reminder", tier: "protected" }), "normal");
  assert.equal(tierOf({ why: "proactive: x", kind: "reminder", tier: "protected", urgentKind: "reminder" }), "protected", "his own reminder (urgent kind) is protected by the gate rule");
  for (const why of ["plan: g1", "proactive: leave-late-1140", "proactive: wake-540", "curiosity: review-2026-10-18", "a reminder he asked for"]) assert.equal(mayBeProtected({ why }), true, why);
});

test("5: orion-reach ignores --kind reminder --tier protected from an arbitrary caller at the ceiling", () => {
  const w = world({ day: 17 });
  w.appendOutreach(Array.from({ length: 21 }, (_, i) => ({ id: `n${i}`, at: at(17, 9, i).toISOString(), text: `n${i}`, kind: "info", why: `proactive: k${i}`, channel: "phone" })));
  const r = w.run("orion-reach", ["spam", "--kind", "reminder", "--why", "proactive: spam", "--tier", "protected"], 17, 0);
  assert.equal(r.status, 3);
});
