// 2026-10-19 live audit, items 1, 2 and 6: priority instead of a flat ceiling, no retry runaway, blank asks back off.
// The data is the incident's: on 10-17 four low-value ladders (finish resume, CS Lab, Review spending, DO MACRO TEST,
// 5 rungs each) used 20 of 20 by 14:37, and the Gym of 17:08 was dropped 168 times, once per tick.
import test from "node:test";
import assert from "node:assert/strict";
import { budgetVerdict, dropGuard, tierOf } from "../scripts/lib/reach/budget.mjs";
import { deliveryOutcome } from "../scripts/lib/reach/delivery.mjs";
import { world, at, planCheckin } from "./incident-world.mjs";

const localDate = (d) => d.toLocaleDateString("en-CA");
const LIMITS = { ceiling: 20, lowValue: 6, blank: 3 };
const TITLES = ["finish resume", "CS Lab", "Review spending", "DO MACRO TEST"];
let n = 0;
const rung = (title, block, when) => ({ id: `r${n++}`, at: when.toISOString(), text: `ping ${title}`, kind: "checkin", why: `plan: ${block}`, channel: "phone", ask: { type: "mismatch", title } });
/** 10-17: four ladders of five rungs, 10:41 to 14:37. */
const incidentRows = () => TITLES.flatMap((t, i) => Array.from({ length: 5 }, (_, k) => rung(t, `cal-${i}`, at(17, 10 + i * 1, 41 + i * 30 + k * 6))));
const verdict = (history, over) => budgetVerdict({ history, date: "2026-10-17", localDate, limits: LIMITS, ...over });

test("1: with 20 of 20 used by the ladders, the gym (a must) still goes; the same nudge as low-value is dropped by the backstop", () => {
  const history = incidentRows();
  assert.equal(history.length, 20);
  assert.deepEqual(verdict(history, { why: "plan: cal-4-adf0e6", tier: "protected" }), { ok: true });
  const low = verdict(history, { why: "plan: cal-4-adf0e6", tier: "low", askTitle: "Gym" });
  assert.equal(low.ok, false); assert.equal(low.reason, "ceiling");
});

test("1: a reminder he set, a class rung and the day review are protected, whatever the budgets say", () => {
  assert.equal(tierOf({ why: "a reminder he asked for", urgentKind: "reminder" }), "protected");
  assert.equal(tierOf({ why: "proactive: leave-late-540", urgentKind: "class" }), "protected");
  assert.equal(tierOf({ why: "curiosity: review-2026-10-17" }), "protected");
  assert.equal(tierOf({ why: "plan: cal-4-adf0e6" }), "low");
  assert.equal(tierOf({ why: "plan: cal-4-adf0e6", tier: "protected" }), "protected");
  assert.equal(tierOf({ why: "curiosity: fill-blank-2026-10-18", askType: "fill-blank" }), "blank");
  assert.equal(verdict(incidentRows(), { why: "curiosity: review-2026-10-17", tier: "protected" }).ok, true);
});

test("1: low-value nudges draw on their own budget, and every rung of one block counts as one", () => {
  // six different blocks, two rungs each: 12 rows, under the ceiling, at the budget of 6 blocks
  const six = Array.from({ length: 6 }, (_, i) => [rung(`task ${i}`, `b${i}`, at(17, 10, i * 10)), rung(`task ${i}`, `b${i}`, at(17, 10, i * 10 + 5))]).flat();
  const seventh = verdict(six, { why: "plan: b6", tier: "low", askTitle: "task 6" });
  assert.deepEqual([seventh.ok, seventh.reason], [false, "budget"]);
  assert.equal(verdict(six, { why: "plan: b2", tier: "low", askTitle: "task 2" }).ok, true, "the next rung of a block already counted is not a new one");
  // five rungs of one block use one slot, not five
  const ladder = Array.from({ length: 5 }, (_, k) => rung("finish resume", "b0", at(17, 10, 41 + k * 10)));
  assert.equal(verdict(ladder, { why: "plan: b1", tier: "low", askTitle: "CS Lab" }).ok, true);
});

test("6: blank asks have their own small budget", () => {
  const blank = (k) => ({ id: `q${k}`, at: at(18, 20 + k).toISOString(), text: "What are you up to?", kind: "question", why: `curiosity: home-gap-${k}`, channel: "phone", ask: { type: "home-gap" } });
  const three = [blank(0), blank(1), blank(2)];
  const fourth = verdict(three, { date: "2026-10-18", why: "curiosity: fill-blank-2026-10-18", tier: "blank" });
  assert.deepEqual([fourth.ok, fourth.reason], [false, "blank-budget"]);
  assert.equal(verdict(incidentRows().slice(0, 10), { why: "curiosity: fill-blank-2026-10-17", tier: "blank" }).ok, true, "ladders do not eat the blank budget (only the backstop applies)");
});

test("2: a dropped message is not retried every tick: cooldown that doubles, then given up (168 rows become 3)", () => {
  const dropped = (when) => ({ id: `d${n++}`, at: when.toISOString(), text: "Time to start: Gym.", why: "plan: cal-4-adf0e6", channel: "hold", status: "dropped", reason: "ceiling" });
  const guard = (history, when) => dropGuard({ history, date: "2026-10-17", localDate, why: "plan: cal-4-adf0e6", now: when.getTime() });
  assert.equal(guard([], at(17, 17, 8)).skip, false);
  const one = [dropped(at(17, 17, 8))];
  assert.deepEqual([guard(one, at(17, 17, 9)).skip, guard(one, at(17, 17, 9)).why], [true, "cooldown"], "36 s later: not again");
  assert.equal(guard(one, at(17, 17, 39)).skip, false, "after the 30 min cooldown it may try once more");
  const two = [...one, dropped(at(17, 17, 39))];
  assert.equal(guard(two, at(17, 18, 30)).skip, true, "the cooldown doubled");
  assert.equal(guard(two, at(17, 18, 40)).skip, false);
  const three = [...two, dropped(at(17, 19, 40))];
  assert.deepEqual([guard(three, at(17, 23, 59)).skip, guard(three, at(17, 23, 59)).why], [true, "gave-up"]);
  assert.equal(dropGuard({ history: three, date: "2026-10-17", localDate, why: "plan: other", now: at(17, 23, 59).getTime() }).skip, false, "another message is unaffected");
});

test("2: orion-reach logs ONE dropped row for a message tried every 36 s, and the caller can tell it was dropped", () => {
  const w = world({ day: 17 });
  w.appendOutreach(incidentRows());
  const results = [];
  for (let k = 0; k < 6; k++) {
    const r = w.run("orion-reach", ["Time to start: Gym.", "--kind", "checkin", "--why", "plan: cal-4-adf0e6"], 17, 8, { extra: { ORION_REACH_NOW: new Date(at(17, 17, 8).getTime() + k * 36_000).toISOString() } });
    results.push(r);
  }
  assert.ok(results.every((r) => r.status === 3));
  assert.match(results[0].stdout, /^NOT SENT: ceiling/); assert.match(results[1].stdout, /^NOT SENT: dropped/);
  assert.equal(w.outreach().filter((r) => r.status === "dropped").length, 1, "one row, not one per tick");
  assert.equal(deliveryOutcome({ status: 3, stdout: results[0].stdout }).dropped, true);
  assert.equal(deliveryOutcome({ status: 3, stdout: results[3].stdout }).dropped, true);
  assert.equal(deliveryOutcome({ status: 3, stdout: "NOT SENT: already reached him 6 times this hour." }).dropped, false);
});

test("1: orion-reach delivers the gym at 20 of 20 when it is protected, and drops it when it is not", () => {
  const w = world({ day: 17 });
  w.appendOutreach(incidentRows());
  const gym = ["Time to start: Gym.", "--kind", "checkin", "--why", "plan: cal-4-adf0e6"];
  const sent = w.run("orion-reach", [...gym, "--tier", "protected"], 17, 8);
  assert.equal(sent.status, 0, sent.stdout + sent.stderr); assert.match(sent.stdout, /^Sent/);
  assert.equal(w.outreach().at(-1).tier, "protected");
  const w2 = world({ day: 17 }); w2.appendOutreach(incidentRows());
  assert.equal(w2.run("orion-reach", gym, 17, 8).status, 3);
});

test("2: a plan loop whose ladder is dropped backs off with a cooldown and gives up silently after 3 (no per-tick retry)", () => {
  const created = at(17, 17, 8).toISOString();
  const w = world({ day: 17, checkins: [planCheckin("ci-gym", "Gym", "cal-4-adf0e6", { createdAt: created, nextCheckAt: Math.floor(at(17, 17, 8).getTime() / 60000), blockWindow: { date: "2026-10-17", start: 1028, end: 1300 } })] });
  w.put(17, 8);
  const reach = w.bin("fake-reach", `echo "$@" >> "${w.home}/reach.log"; echo "NOT SENT: ceiling - already reached him 20 times today."; exit 3`);
  // a tick every 10 minutes for two hours (the old code tried on every one)
  for (let m = 0; m <= 120; m += 10) w.run("orion-checkin", ["tick", "--json"], 17 + Math.floor((m + 8) / 60), (m + 8) % 60, { extra: { ORION_REACH_BIN: reach } });
  const calls = w.lines("reach.log").length;
  assert.equal(calls, 3, `three tries in two hours, not one per tick (got ${calls})`);
  const c = w.checkins().find((x) => x.id === "ci-gym");
  assert.equal(c.drops, 3); assert.equal(c.loop.phase, "given_up");
});

test("6: a blank ask dropped by the budget is recorded and backs off: the 25 regenerations of 10-18 become one per 60+ minutes", () => {
  const w = world({ day: 18, awOver: { location: { state: "unknown", placeId: null, homeKnown: true } } });
  const blank = (k) => ({ id: `q${k}`, at: at(18, 18, 20 + k).toISOString(), text: "What are you up to?", kind: "question", why: `curiosity: home-gap-${k}`, tier: "blank", channel: "phone", ask: { type: "home-gap" } });
  w.appendOutreach([blank(0), blank(1), blank(2)]);   // the blank budget (3) is spent
  const reachRows = () => w.outreach().filter((r) => r.why === "curiosity: fill-blank-2026-10-18");
  assert.equal(w.tick(20, 5).status, 0);
  assert.equal(reachRows().length, 1, "tried once and dropped");
  assert.equal(w.ledger().asks.filter((a) => a.type === "fill-blank" && a.dropped).length, 1, "recorded as dropped");
  for (const m of [10, 15, 20, 30, 45, 59]) w.tick(20, m);
  w.tick(21, 30);
  assert.equal(reachRows().length, 1, "no new try while the backoff runs (a dropped ask counts as ignored: 60 min doubles to 120)");
  w.tick(22, 10);
  assert.equal(reachRows().length, 2, "one retry after the backoff");
  for (const m of [15, 30, 50]) w.tick(23, m - 10);
  assert.equal(reachRows().length, 2, "and the gap has doubled again");
  assert.ok(reachRows().every((r) => r.status === "dropped"));
});
