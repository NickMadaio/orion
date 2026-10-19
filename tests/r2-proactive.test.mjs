// Round 2 review of the proactive bundle: bedtime statements, budgets, the review across midnight, and who may ask for `protected`.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBedtimeStatement, noteInboundText, activeDeclaration } from "../scripts/lib/awareness/declared.mjs";
import { readAwareness } from "../scripts/lib/awareness/state.mjs";
import { budgetVerdict, tierOf } from "../scripts/lib/reach/budget.mjs";
import { decide } from "../scripts/lib/reach/proactive.mjs";
import { aw } from "./fixtures/curiosity-aw.mjs";
import { world, at } from "./incident-world.mjs";

const localDate = (d) => d.toLocaleDateString("en-CA");

test("1: phrases that are not 'I am going to sleep now' do not declare", () => {
  for (const t of ["just turning in my essay", "my roommate is going to bed so ill be quiet", "had a good night out with sam", "going to sleep for 20 min", "heading to bed after this episode"]) assert.equal(isBedtimeStatement(t), false, t);
  for (const t of ["going to bed now", "goodnight orion", "im heading to sleep", "night, going to bed"]) assert.equal(isBedtimeStatement(t), true, t);
});

test("1: it only declares after 21:00 (or before 06:00, or within 3 h of bed): 'going to bed now' at 15:00 is not sleep", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "orion-r2-"));
  const d1 = dir(); assert.equal(noteInboundText({ dir: d1, text: "going to bed now", now: at(19, 15, 0) }), null); assert.equal(activeDeclaration({ dir: d1, now: at(19, 15, 1) }), null);
  const d2 = dir(); assert.equal(noteInboundText({ dir: d2, text: "going to bed now", now: at(19, 21, 30) }), "declared");
  const d3 = dir(); assert.equal(noteInboundText({ dir: d3, text: "going to bed now", now: at(19, 20, 50), bedtime: "23:30" }), "declared", "within 3 h of bed");
});

test("1: real Mac input 15+ minutes after the declaration clears it; 7 minutes after does not", () => {
  const w = world({ day: 19 });
  w.run("orion-inbound-turn", ["--text", "going to bed now"], 1, 43);
  w.put(1, 50); assert.equal(readAwareness({ dir: w.dir, now: at(19, 1, 50) }).sleep.state, "asleep", "7 min: the tail of the goodnight");
  w.put(2, 5); assert.notEqual(readAwareness({ dir: w.dir, now: at(19, 2, 5) }).sleep.state, "asleep", "the Mac is active at 02:05: he is up");
  assert.equal(activeDeclaration({ dir: w.dir, now: at(19, 2, 6) }), null);
});

let n = 0;
const rung = (title, block, when) => ({ id: `r${n++}`, at: when.toISOString(), text: `ping ${title}`, kind: "checkin", why: `plan: ${block}`, channel: "phone", ask: { type: "mismatch", title } });
const LIMITS = { ceiling: 20, lowValue: 6, blank: 3 };

test("2: six blocks of five rungs (30 rows) count as 6 toward the ceiling: the starvation pattern does not return", () => {
  const history = Array.from({ length: 6 }, (_, b) => Array.from({ length: 5 }, (_, k) => rung(`task ${b}`, `b${b}`, at(17, 10, b * 20 + k * 3)))).flat();
  assert.equal(history.length, 30);
  const v = (over) => budgetVerdict({ history, date: "2026-10-17", localDate, limits: LIMITS, ...over });
  assert.equal(v({ why: "proactive: bed-wind", tier: "normal" }).ok, true, "an ordinary line is not blocked by 30 rungs");
  assert.equal(v({ why: "plan: gym", tier: "protected" }).ok, true);
  assert.equal(v({ why: "plan: b7", tier: "low", askTitle: "task 7" }).reason, "budget", "the seventh block is a budget drop, not a ceiling drop");
});

const dropper = (w) => w.bin("fake-reach", `echo "$@" >> "${w.home}/reach.log"; echo "NOT SENT: ceiling - already reached him 20 times today."; exit 3`);
const sentState = (w) => { try { return JSON.parse(readFileSync(join(w.dir, "proactive-sent.json"), "utf8")); } catch { return {}; } };

test("2: a message dropped by a budget is not marked said, so the cooldown/retry path runs on the next tick", () => {
  const w = world({ day: 19 });
  const extra = { ORION_REACH_BIN: dropper(w) };
  for (const [h, m] of [[23, 35], [23, 40]]) w.run("orion-proactive", ["tick"], h, m, { extra });
  const calls = w.lines("reach.log").filter((l) => l.includes("Bed at"));
  assert.equal(calls.length, 2, "tried again, not silently given up");
  assert.equal(Object.keys(sentState(w)["2026-10-19"] ?? {}).includes("bed-wind"), false);
});

test("2: a fixed-destination leave line ('out the door now - Dinner with Sam') is protected", () => {
  const dinner = { id: "d", title: "Dinner with Sam", kind: "social", start: 1140, end: 1230, fixed: true, source: "calendar" };
  const out = decide({ minute: 1105, day: [dinner], travel: [{ title: "Commute to Dinner", start: 1100, end: 1140 }], atHome: true, sent: {}, bed: "23:45", wake: "07:45", today: "2026-10-19", tomorrow: "2026-10-20" });
  const line = out.find((m) => /out the door now/.test(m.text));
  assert.ok(line, JSON.stringify(out));
  assert.equal(line.tier, "protected");
});

test("11: --tier protected is honoured only for a reminder, a plan ladder or the review; any other caller is an ordinary message", () => {
  assert.equal(tierOf({ why: "proactive: x", kind: "info", tier: "protected" }), "normal");
  assert.equal(tierOf({ why: "curiosity: fill-blank-1", kind: "question", tier: "protected", askType: "fill-blank" }), "blank");
  assert.equal(tierOf({ why: "plan: g1", kind: "checkin", tier: "protected" }), "protected");
  assert.equal(tierOf({ why: "proactive: leave-late-1140", kind: "reminder", tier: "protected" }), "protected");
  assert.equal(tierOf({ why: "curiosity: review-2026-10-18", kind: "update" }), "protected");
});

test("11: orion-reach ignores a forged --tier protected at the ceiling", () => {
  const w = world({ day: 17 });
  w.appendOutreach(Array.from({ length: 21 }, (_, i) => ({ id: `n${i}`, at: at(17, 9, i).toISOString(), text: `n${i}`, kind: "info", why: `proactive: k${i}`, channel: "phone" })));
  const forged = w.run("orion-reach", ["spam", "--kind", "info", "--why", "proactive: spam", "--tier", "protected"], 17, 0);
  assert.equal(forged.status, 3); assert.match(forged.stdout, /ceiling/);
});

const home = { location: { state: "unknown", placeId: null, homeKnown: true } };
const reviewRows = (w) => w.outreach().filter((r) => /^curiosity: review-/.test(r.why ?? ""));

test("4: 'goodnight orion' at 21:50 sends the review right then, before the declaration holds everything", () => {
  const w = world({ day: 18, awOver: home });
  const r = w.run("orion-inbound-turn", ["--text", "goodnight orion"], 21, 50);
  assert.equal(r.status, 0, r.stderr);
  for (let i = 0; i < 60 && !reviewRows(w).length; i++) spawnSync("sleep", ["0.25"]);   // the review runs detached
  const rows = reviewRows(w);
  assert.equal(rows.length, 1); assert.equal(rows[0].why, "curiosity: review-2026-10-18"); assert.equal(rows[0].status, undefined, "delivered, not held");
  assert.ok(activeDeclaration({ dir: w.dir, now: at(18, 21, 55) }), "and then he is asleep");
  for (let i = 0; i < 20 && !sentState(w)["2026-10-18"]?.["review-2026-10-18"]; i++) spawnSync("sleep", ["0.25"]);
  assert.equal(sentState(w)["2026-10-18"]["review-2026-10-18"], true);
  w.tick(22, 5, { ...home, sleep: { state: "awake" } });
  assert.equal(reviewRows(w).length, 1, "not sent twice");
});

test("4: a review held by a focus session across midnight is released at its end (small hours, awake), once", () => {
  const w = world({ day: 18, awOver: home });
  const focus = { ...home, session: { state: "focus", task: "essay" } };
  w.tick(22, 5, focus); w.tick(23, 30, focus);
  assert.equal(reviewRows(w).length, 0, "held while the session runs");
  assert.equal(sentState(w)["2026-10-18"]["review-held-2026-10-18"], true);
  w.tick(0, 30, home, [], 19);
  const rows = reviewRows(w);
  assert.equal(rows.length, 1, "released at session end");
  assert.equal(rows[0].why, "curiosity: review-2026-10-18");
  w.tick(0, 45, home, [], 19);
  assert.equal(reviewRows(w).length, 1);
  const w2 = world({ day: 18, awOver: home });   // never held: still not sent after midnight
  w2.tick(0, 30, home, [], 19); assert.equal(reviewRows(w2).length, 0);
});
