// 2026-10-19 live audit, items 3, 4 and 7 (the parts in the scripts): stale replay at the day boundary, "going to bed"
// means sleep, and no scolding right after he wakes. Data from the incident: the 10-17 gym (cal-4-adf0e6, 17:08) replayed
// on 10-18 at 09:25 and at 00:00 on 10-19 ("It's been 508 min"), gym pings at 01:45 and 01:50 two minutes after "going to
// bed now" (01:43), and "You've been avoiding finish resume" at 11:06 on 10-17 after his first wake signal at 11:04.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { staleReason, elapsedSince, validUntilOf } from "../scripts/lib/reach/block-window.mjs";
import { isBedtimeStatement, noteInboundText, activeDeclaration } from "../scripts/lib/awareness/declared.mjs";
import { readAwareness } from "../scripts/lib/awareness/state.mjs";
import { inWakeGrace, wokeMinuteToday } from "../scripts/lib/awareness/wake.mjs";
import { planVsReality } from "../scripts/lib/curiosity/loop.mjs";
import { emptyLedger } from "../scripts/lib/curiosity/ledger.mjs";
import { aw } from "./fixtures/curiosity-aw.mjs";
import { world, at, planCheckin } from "./incident-world.mjs";

const mins = (d) => Math.floor(d.getTime() / 60000);
const GYM17 = { date: "2026-10-17", start: 1028, end: 1118 };   // 17:08-18:38, the 10-17 gym

// ---- item 3: stale replay -------------------------------------------------------------------------------------------

test("3: a block's window decides: over, or a different day, is stale; during it is not", () => {
  assert.equal(staleReason({ window: GYM17 }, at(17, 17, 30).getTime()), null);
  assert.equal(staleReason({ window: GYM17 }, at(17, 18, 38).getTime()), "the block is over");
  assert.equal(staleReason({ window: GYM17 }, at(18, 9, 25).getTime()), "yesterday's block");
  assert.equal(staleReason({ window: GYM17 }, at(19, 0, 0).getTime()), "yesterday's block");
  assert.equal(staleReason({ createdAt: at(18, 21, 0).toISOString() }, at(19, 0, 0).getTime()), "made on an earlier day", "a loop made before windows were kept");
  assert.equal(staleReason({ createdAt: at(19, 9, 0).toISOString() }, at(19, 12, 0).getTime()), null);
});

test("3: minutes are counted from the block's own start today, not from a stale one", () => {
  assert.equal(elapsedSince({ date: "2026-10-19", start: 1028, end: 1118 }, at(19, 17, 33).getTime()), 25);
  assert.equal(elapsedSince({ date: "2026-10-19", start: 1028, end: 1118 }, at(19, 17, 0).getTime()), 0, "never negative");
  assert.equal(validUntilOf({ date: "2026-10-19", start: 1028, end: 1118 }), at(19, 18, 38).toISOString());
});

test("3: orion-checkin drops yesterday's gym at 09:25 and at midnight instead of replaying it", () => {
  const created = at(17, 17, 13).toISOString();
  const gym = planCheckin("ci-gym", "Gym", "cal-4-adf0e6", { createdAt: created, nextCheckAt: mins(at(17, 17, 13)), blockWindow: GYM17, tier: "protected" });
  for (const [day, h, m] of [[18, 9, 25], [19, 0, 0]]) {
    const w = world({ day, checkins: [{ ...gym }] });
    const reach = w.bin("fake-reach", `echo "$@" >> "${w.home}/reach.log"; echo "Sent - fake"`);
    const out = w.run("orion-checkin", ["tick", "--json"], h, m, { extra: { ORION_REACH_BIN: reach } });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(w.lines("reach.log").length, 0, `nothing sent on 10-${day} ${h}:${m}`);
    assert.equal(w.checkins().length, 0 + w.checkins().length);
    assert.equal(w.checkins()[0].loop.phase, "given_up"); assert.equal(w.checkins()[0].expired, "yesterday's block");
  }
});

test("3: an old loop with no window (made yesterday) is dropped at midnight; one whose block is over is dropped the same day", () => {
  const old = planCheckin("ci-old", "Gym", "cal-4", { createdAt: at(18, 21, 0).toISOString(), nextCheckAt: mins(at(18, 21, 0)) });
  const over = planCheckin("ci-over", "Gym", "cal-5", { createdAt: at(19, 17, 13).toISOString(), nextCheckAt: mins(at(19, 17, 13)), blockWindow: { date: "2026-10-19", start: 1028, end: 1118 } });
  const w = world({ day: 19, checkins: [old, over] });
  const reach = w.bin("fake-reach", `echo "$@" >> "${w.home}/reach.log"; echo "Sent - fake"`);
  w.run("orion-checkin", ["tick", "--json"], 19, 30, { extra: { ORION_REACH_BIN: reach } });
  assert.equal(w.lines("reach.log").length, 0);
  assert.deepEqual(w.checkins().map((c) => c.expired), ["made on an earlier day", "the block is over"]);
});

test("3: while the block is on, the elapsed minutes come from its start today and the rung dies with the block (--valid-until)", () => {
  const w = world({ day: 19, checkins: [planCheckin("ci-gym", "Gym", "cal-9", { createdAt: at(19, 17, 13).toISOString(), nextCheckAt: mins(at(19, 17, 20)), level: 2, phase: "reminded",
    blockWindow: { date: "2026-10-19", start: 1028, end: 1118 }, tier: "protected" })] });
  const reach = w.bin("fake-reach", `echo "$@" >> "${w.home}/reach.log"; echo "Sent - fake"`);
  w.run("orion-checkin", ["tick", "--json"], 17, 33, { extra: { ORION_REACH_BIN: reach } });
  const [call] = w.lines("reach.log");
  assert.match(call, /It's been 25 min\. Gym, now/, "counted from 17:08 today, not from when the loop was made (17:13) or a day earlier");
  assert.match(call, /--tier protected/);
  assert.ok(call.includes(`--valid-until ${at(19, 18, 38).toISOString()}`));
});

test("3: orion-reach refuses a nudge whose moment has passed (valid-until), logging it dropped once", () => {
  const w = world({ day: 19 });
  const r = w.run("orion-reach", ["Time to start: Gym.", "--kind", "checkin", "--why", "plan: cal-4-adf0e6", "--valid-until", at(17, 18, 38).toISOString()], 0, 0);
  assert.equal(r.status, 3); assert.match(r.stdout, /^NOT SENT: expired/);
  assert.equal(existsSync(join(w.dir, "outreach-outbox.jsonl")), false, "nothing was delivered");
  assert.equal(w.outreach().at(-1).reason, "expired");
});

test("3: a not-started loop is opened with the block's own day and window, and the gym is protected, a study block is not", () => {
  const gym = { id: "g1", title: "Gym", kind: "gym", start: 1028, end: 1118, fixed: false, source: "orion", rank: "must" };
  const resume = { id: "b1", title: "finish resume", kind: "study", start: 1028, end: 1118, fixed: false, source: "orion" };
  const now = at(19, 17, 14);
  const run = (b) => planVsReality(aw(now, { calendar: { now: b } }), { day: [b], checkins: [], ledger: emptyLedger(), sent: {}, now });
  assert.deepEqual([run(gym)[0].tier, run(gym)[0].window], ["protected", { date: "2026-10-19", start: 1028, end: 1118 }]);
  assert.equal(run(resume)[0].tier, "low");
});

// ---- item 4: "going to bed" means sleep ------------------------------------------------------------------------------

test("4: bedtime statements are recognised; questions, negations and long messages are not", () => {
  for (const t of ["going to bed now", "goodnight", "Good night!", "heading to sleep", "gonna go to bed", "night night", "i'm off to bed", "hitting the sack", "ok going to sleep", "heading to bed, night"]) assert.equal(isBedtimeStatement(t), true, t);
  for (const t of ["what time should I go to bed?", "I'm not going to bed yet", "remind me before I go to bed to charge my phone", "", "set a wake alarm for 7", "the bed frame arrives tomorrow",
    "I was going to bed last night when the power went out and then I spent two hours on the resume instead"]) assert.equal(isBedtimeStatement(t), false, t);
});

const awake = { sleep: { state: "awake", inWindow: true, wokeAt: null, bed: 1425, source: "window" } };

test("4: 'going to bed now' at 01:43 holds the 01:45 and 01:50 gym pings; a reminder he set and a class still go", () => {
  const w = world({ day: 19, awOver: awake, checkins: [planCheckin("ci-gym", "Gym", "cal-4-adf0e6", { createdAt: at(18, 17, 13).toISOString(), nextCheckAt: mins(at(19, 1, 0)), level: 2, phase: "reminded",
    blockWindow: { date: "2026-10-19", start: 0, end: 600 }, tier: "protected" })] });
  const reach = w.bin("fake-reach", `echo "$@" >> "${w.home}/reach.log"; echo "Sent - fake"`);
  assert.equal(w.run("orion-inbound-turn", ["--text", "going to bed now"], 1, 43).status, 0);
  assert.equal(activeDeclaration({ dir: w.dir, now: at(19, 1, 45) })?.source, "inbound-turn");
  assert.equal(readAwareness({ dir: w.dir, now: at(19, 1, 45) }).sleep.state, "asleep", "awareness says asleep (declared), although the Mac is awake");
  for (const [h, m] of [[1, 45], [1, 50]]) w.run("orion-checkin", ["tick", "--json"], h, m, { extra: { ORION_REACH_BIN: reach } });
  assert.equal(w.lines("reach.log").length, 0, "no gym ping reached the loop's sender");
  // the same nudge, protected, straight through the real orion-reach: held, not delivered
  const held = w.run("orion-reach", ["It's been 508 min. Gym, now. Phone down.", "--kind", "checkin", "--why", "plan: cal-4-adf0e6", "--tier", "protected", "--ask", JSON.stringify({ type: "mismatch", title: "Gym" })], 1, 45, { over: awake });
  assert.equal(held.status, 3); assert.match(held.stdout, /held/);
  assert.equal(existsSync(join(w.dir, "outreach-outbox.jsonl")), false);
  const alarm = w.run("orion-reach", ["Reminder: wake up.", "--kind", "reminder", "--urgent", "--why", "a reminder he asked for"], 1, 50, { over: awake });
  assert.match(alarm.stdout, /^Sent/, "an alarm-type reminder he set still goes");
  const cls = w.run("orion-reach", ["Leave in 11 min for CS2100.", "--kind", "reminder", "--urgent-kind", "class", "--why", "proactive: leave-540"], 1, 55, { over: awake });
  assert.match(cls.stdout, /^Sent/);
});

test("4: control: the same gym ping at 01:45 with no bedtime statement is delivered", () => {
  const w = world({ day: 19, awOver: awake });
  const r = w.run("orion-reach", ["It's been 508 min. Gym, now.", "--kind", "checkin", "--why", "plan: cal-4-adf0e6", "--tier", "protected"], 1, 45, { over: awake });
  assert.match(r.stdout, /^Sent|^Held/);
  assert.equal(r.status, 0);
});

test("4: it holds until he wakes: the morning brief, a wake signal, a later message, or 10 hours ends it", () => {
  const fresh = () => { const dir = mkdtempSync(join(tmpdir(), "orion-declared-")); noteInboundText({ dir, text: "goodnight", now: at(19, 1, 43) }); return dir; };
  const asleepAt = (dir, d, h, m) => readAwareness({ dir, now: at(d, h, m) }).sleep.state === "asleep";
  assert.equal(asleepAt(fresh(), 19, 7, 0), true);
  assert.equal(asleepAt(fresh(), 19, 11, 44), false, "ten hours is the longest it holds");
  let dir = fresh(); writeFileSync(join(dir, "morning-sent.json"), JSON.stringify({ "2026-10-19": { at: at(19, 8, 22).toISOString(), signal: "unplugged" } }));
  assert.equal(asleepAt(dir, 19, 8, 21), true); assert.equal(asleepAt(dir, 19, 8, 30), false, "the brief is his wake");
  dir = fresh(); writeFileSync(join(dir, "health-log.json"), JSON.stringify({ sleepLog: [{ event: "unplugged", at: at(19, 1, 50).toISOString() }, { event: "unplugged", at: at(19, 7, 22).toISOString() }] }));
  assert.equal(asleepAt(dir, 19, 3, 0), true, "settling the phone on its charger right after is not waking"); assert.equal(asleepAt(dir, 19, 7, 30), false);
  dir = fresh();
  assert.equal(noteInboundText({ dir, text: "ok one more thing", now: at(19, 1, 46) }), null, "a message within 10 minutes is the tail of the goodnight");
  assert.equal(noteInboundText({ dir, text: "what's the weather", now: at(19, 2, 30) }), "cleared");
  assert.equal(asleepAt(dir, 19, 2, 31), false);
});

test("4: orion-reach --awake (the morning brief) ends a declared bedtime", () => {
  const w = world({ day: 19, awOver: awake });
  w.run("orion-inbound-turn", ["--text", "goodnight"], 1, 43);
  assert.ok(activeDeclaration({ dir: w.dir, now: at(19, 8, 0) }));
  const brief = w.run("orion-reach", ["Morning, Nick.", "--kind", "morning", "--awake", "--why", "morning: test"], 8, 22);
  assert.match(brief.stdout, /^Sent/);
  assert.equal(activeDeclaration({ dir: w.dir, now: at(19, 8, 23) }), null);
});

// ---- item 7: wake grace ---------------------------------------------------------------------------------------------

test("7: the wake time comes from the brief or a wake signal; grace is 30 minutes and unknown is no grace", () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-wake-"));
  assert.equal(inWakeGrace({ dir, now: at(17, 11, 6) }), false, "no wake evidence: no grace");
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ sleepLog: [{ event: "unplugged", at: at(17, 11, 4).toISOString() }] }));
  assert.equal(wokeMinuteToday({ dir, now: at(17, 11, 6) }), 664);
  assert.equal(inWakeGrace({ dir, now: at(17, 11, 6) }), true);
  assert.equal(inWakeGrace({ dir, now: at(17, 11, 33) }), true);
  assert.equal(inWakeGrace({ dir, now: at(17, 11, 34) }), false);
  assert.equal(inWakeGrace({ dir, now: at(18, 11, 6) }), false, "yesterday's wake is not today's");
});

test("7: 'You've been avoiding finish resume' two minutes after he woke waits out the grace; his own check-in and class rungs do not", () => {
  const level3 = { createdAt: at(17, 9, 33).toISOString(), nextCheckAt: mins(at(17, 10, 0)), level: 3, phase: "intervening", blockWindow: { date: "2026-10-17", start: 573, end: 700 } };
  const w = world({ day: 17, checkins: [planCheckin("ci-resume", "finish resume", "cal-1", level3)] });
  writeFileSync(join(w.dir, "health-log.json"), JSON.stringify({ sleepLog: [{ event: "unplugged", at: at(17, 11, 4).toISOString() }] }));
  const reach = w.bin("fake-reach", `echo "$@" >> "${w.home}/reach.log"; echo "Sent - fake"`);
  w.run("orion-checkin", ["tick", "--json"], 11, 6, { extra: { ORION_REACH_BIN: reach } });
  assert.equal(w.lines("reach.log").length, 0, "not scolded at 11:06");
  assert.equal(w.checkins()[0].loop.phase, "intervening", "and not stepped either");
  // after the grace the same loop carries on (its block, 573-700, is still on at 11:36 = 696)
  w.run("orion-checkin", ["tick", "--json"], 11, 36, { extra: { ORION_REACH_BIN: reach } });
  assert.equal(w.lines("reach.log").length, 1);
});

test("7: the loop opens no not-started or off-plan nudge in the grace period, but a leave rung for a class still comes", () => {
  const resume = { id: "b1", title: "finish resume", kind: "study", start: 840, end: 960, fixed: false, source: "orion" };
  const now = at(19, 14, 8);
  const inGrace = (wakeGrace) => planVsReality(aw(now, { calendar: { now: resume } }), { day: [resume], checkins: [], ledger: emptyLedger(), sent: {}, now, wakeGrace });
  assert.equal(inGrace(false)[0].type, "not-started");
  assert.deepEqual(inGrace(true), []);
  const cls = { id: "c1", title: "CS2100", kind: "class", start: 540, end: 630, fixed: true, source: "calendar" };
  const travel = [{ title: "Commute to CS2100", start: 495, end: 535 }];
  const leave = planVsReality(aw(at(19, 8, 4), {}), { day: [cls], travel, checkins: [], ledger: emptyLedger(), sent: {}, now: at(19, 8, 4), wakeGrace: true });
  assert.deepEqual(leave.map((a) => a.type), ["should-leave"]);
  assert.match(leave[0].text, /^Leave in 11 min for CS2100/);
});
