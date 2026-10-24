// 2026-10-23: "he'll text me proactively saying go to bed WHILE IM TRYING TO SLEEP". Fixtures are the real rows from
// outreach.jsonl, health-log.json and the Mac chat (times UTC; London is UTC+1 on these dates; bedtime 00:00).
process.env.TZ = "Europe/London";
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bedtimeVerdict, bedtimeSentTonight, minutesPastBed, NIGHTLY_CAP, nightOf, readBedtimeEvidence } from "../scripts/lib/reach/bedtime-guard.mjs";
import { harness } from "./delivery-helpers.mjs";

const BED = 0;   // 00:00
const at = (iso) => new Date(iso);
const active = { locked: false, idleSeconds: 20 };

test("minutes past bed crosses midnight on the evening clock", () => {
  assert.equal(minutesPastBed(23 * 60 + 33, BED), -27);
  assert.equal(minutesPastBed(43, BED), 43);
  assert.equal(minutesPastBed(23 * 60 + 50, 23 * 60 + 45), 5);
});

test("10-19 23:43Z 'Still up at 12:43 AM' after he answered the 12:02 nag with 'im doing work shush up': held", () => {
  const v = bedtimeVerdict({ now: at("2026-10-19T23:43:08.765Z"), bed: BED, mac: active, ack: { night: "2026-10-19", at: "2026-10-19T23:03:03Z" }, sentTonight: 2 });
  assert.equal(v.ok, false);
  assert.match(v.reason, /answered a bedtime message/);
});

test("10-19 23:44Z: phone on the charger and still at night (health-log), Mac unlocked but untouched for 6 min: held", () => {
  const v = bedtimeVerdict({ now: at("2026-10-19T23:50:00Z"), bed: BED, mac: { locked: false, idleSeconds: 6 * 60 }, phone: { at: "2026-10-19T23:44:27Z", charging: true, motion: "still" }, sentTonight: 0 });
  assert.equal(v.ok, false);
  assert.match(v.reason, /charger and still/);
});

// Review 2026-10-23 (MEDIUM 7): a phone on its charger does not mean he is in bed while he is typing at the Mac.
test("phone on the charger and still, but he is typing at the Mac (input 20 s ago): not held for the charger", () => {
  const v = bedtimeVerdict({ now: at("2026-10-19T23:50:00Z"), bed: BED, mac: active, phone: { at: "2026-10-19T23:44:27Z", charging: true, motion: "still" }, sentTonight: 0 });
  assert.equal(v.ok, true);
});

test("phone on the charger but in his hand (screen unlocked just now): not settled", () => {
  const v = bedtimeVerdict({ now: at("2026-10-19T23:50:00Z"), bed: BED, mac: active, phone: { at: "2026-10-19T23:44:27Z", charging: true, motion: "still" },
    screen: { at: "2026-10-19T23:48:00Z", locked: false }, sentTonight: 0 });
  assert.equal(v.ok, true);
});

test("10-22 23:42Z 'Still up at 12:42 AM' was the third bedtime line that night: the cap holds it", () => {
  const rows = [
    { id: "a", at: "2026-10-22T22:31:43.821Z", why: "proactive: bed-wind", channel: "mac-voice" },
    { id: "b", at: "2026-10-22T23:02:02.806Z", why: "proactive: bed-now", channel: "mac-bubble" },
    { id: "x", at: "2026-10-22T22:31:43Z", why: "proactive: review-2026-10-22", channel: "mac-voice" },
    { id: "h", at: "2026-10-22T23:10:00Z", why: "proactive: bed-now", channel: "hold" },
  ];
  const now = at("2026-10-22T23:42:13.695Z");
  assert.equal(bedtimeSentTonight(rows, now), 2);
  const v = bedtimeVerdict({ now, bed: BED, mac: active, sentTonight: bedtimeSentTonight(rows, now) });
  assert.equal(v.ok, false);
  assert.match(v.reason, new RegExp(`${NIGHTLY_CAP} bedtime`));
});

test("10-18 00:43 'going to bed now', then any bedtime line: held (goodnight said)", () => {
  const v = bedtimeVerdict({ now: at("2026-10-19T00:50:00Z"), bed: BED, mac: active, declaredAt: "2026-10-19T00:43:15Z", sentTonight: 0 });
  assert.equal(v.ok, false);
});

test("after bedtime with the Mac locked, or no Mac/phone use for 15+ min: never a nag, never a push", () => {
  assert.equal(bedtimeVerdict({ now: at("2026-10-20T23:05:00Z"), bed: BED, mac: { locked: true, idleSeconds: 30 }, sentTonight: 0 }).ok, false);
  assert.equal(bedtimeVerdict({ now: at("2026-10-20T23:28:48Z"), bed: BED, mac: { locked: false, idleSeconds: 16 * 60 }, sentTonight: 1 }).ok, false);
  assert.equal(bedtimeVerdict({ now: at("2026-10-20T23:28:48Z"), bed: BED, mac: {}, sentTonight: 1 }).ok, false);   // unknown input is not "up"
});

test("at the Mac and typing after bedtime, nothing else known: the line may go (he is up)", () => {
  assert.equal(bedtimeVerdict({ now: at("2026-10-20T23:05:00Z"), bed: BED, mac: active, sentTonight: 1 }).ok, true);
});

test("the night key runs to 06:00", () => {
  assert.equal(nightOf(at("2026-10-20T03:00:00Z")), "2026-10-19");
  assert.equal(nightOf(at("2026-10-20T22:00:00Z")), "2026-10-20");
});

// End to end through orion-reach: the bedtime line is dropped (logged, exit 0, nothing in the outbox), not routed to the phone.
function bedNight(now, facts) {
  const h = harness({ now, facts });
  writeFileSync(join(h.home, "config.json"), JSON.stringify({ bedtime: "00:00", usualWake: "09:00" }));
  h.setAwareness({ sleep: { state: "late-awake", inWindow: true, bed: 1440, at: now.toISOString() } });
  return h;
}

test("orion-reach: 10-19 22:33Z-style line with the phone settled on the charger is dropped, not pushed", () => {
  const now = at("2026-10-19T23:50:00Z");
  const h = bedNight(now, { idleSeconds: 9999, locked: true });
  writeFileSync(join(h.dir, "health-log.json"), JSON.stringify({ phoneSignals: [{ at: "2026-10-19T23:44:27Z", charging: true, motion: "still" }] }));
  const r = h.run("orion-reach", ["Still up at 12:50 AM — go now.", "--kind", "reminder", "--why", "proactive: bed-late", "--no-queue"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /not sent/i);
  assert.deepEqual(h.read("outreach-outbox.jsonl"), []);
  const row = h.read("outreach.jsonl").at(-1);
  assert.equal(row.status, "dropped");
  assert.equal(row.reason, "in-bed");
});

test("orion-reach: his reply to a bedtime line (bedtime-ack.json, written by orion-inbound-turn) stops the next rung", () => {
  const now = at("2026-10-19T23:43:08Z");
  const h = bedNight(now, { idleSeconds: 10, locked: false });
  writeFileSync(join(h.dir, "bedtime-ack.json"), JSON.stringify({ night: "2026-10-19", at: "2026-10-19T23:03:03Z" }));
  const r = h.run("orion-reach", ["Still up at 12:43 AM — 8h 17m left.", "--kind", "reminder", "--why", "proactive: bed-late", "--no-queue"]);
  assert.equal(r.status, 0);
  assert.deepEqual(h.read("outreach-outbox.jsonl"), []);
});

test("orion-reach: other kinds are untouched by the bedtime guard (a reminder he set still goes)", () => {
  const now = at("2026-10-19T23:43:08Z");
  const h = bedNight(now, { idleSeconds: 9999, locked: true });
  writeFileSync(join(h.dir, "bedtime-ack.json"), JSON.stringify({ night: "2026-10-19", at: "2026-10-19T23:03:03Z" }));
  const r = h.run("orion-reach", ["Take your meds", "--kind", "reminder", "--urgent", "--why", "reminder: meds"]);
  assert.equal(r.status, 0);
  assert.equal(h.read("outreach-outbox.jsonl").length, 1);
});

test("orion-inbound-turn: 'im doing work shush up' 7 s after the 12:02 bedtime line writes tonight's bedtime ack", () => {
  const now = at("2026-10-19T23:03:03Z");
  const h = bedNight(now, { idleSeconds: 10, locked: false });
  appendFileSync(join(h.dir, "outreach.jsonl"), `${JSON.stringify({ id: "reach-1792450976763-60ce0e", at: "2026-10-19T23:02:56.763Z", text: "It's 12:02 AM, bedtime. Sleep now and you get 8h 58m before your alarm.", kind: "reminder", why: "proactive: bed-now", channel: "mac-bubble" })}\n`);
  const r = h.run("orion-inbound-turn", ["--text", "im doing work shush up"]);
  assert.equal(r.status, 0, r.stderr);
  const ack = JSON.parse(readFileSync(join(h.dir, "bedtime-ack.json"), "utf8"));
  assert.equal(ack.night, "2026-10-19");
});

// "Bed at 12:00 AM — … Start wrapping up." (bed-wind, 30 min before bed): held by the same in-bed signals.
const WIND = at("2026-10-19T22:33:41Z");   // 23:33 London, 27 min before a 00:00 bed (the 10-19 phone push)
test("wind-down line: held when the phone is on the charger and still, the Mac is locked, he said goodnight, or 15+ min idle", () => {
  assert.equal(bedtimeVerdict({ now: WIND, bed: BED, mac: { locked: false, idleSeconds: 8 * 60 }, phone: { at: "2026-10-19T22:30:00Z", charging: true, motion: "still" }, sentTonight: 0 }).ok, false);
  assert.equal(bedtimeVerdict({ now: WIND, bed: BED, mac: { locked: true, idleSeconds: 60 }, sentTonight: 0 }).ok, false);
  assert.equal(bedtimeVerdict({ now: WIND, bed: BED, mac: active, declaredAt: "2026-10-19T22:20:00Z", sentTonight: 0 }).ok, false);
  const idle = bedtimeVerdict({ now: WIND, bed: BED, mac: { locked: false, idleSeconds: 16 * 60 }, sentTonight: 0 });
  assert.equal(idle.ok, false);
  assert.match(idle.reason, /wind-down/);
});
test("wind-down line: still goes when he is up (at the Mac, or the phone in his hand), and earlier than 30 min before bed nothing is held for idling", () => {
  assert.equal(bedtimeVerdict({ now: WIND, bed: BED, mac: active, sentTonight: 0 }).ok, true);
  assert.equal(bedtimeVerdict({ now: WIND, bed: BED, mac: { locked: false, idleSeconds: 16 * 60 }, screen: { at: "2026-10-19T22:32:00Z", locked: false }, sentTonight: 0 }).ok, true);
  assert.equal(bedtimeVerdict({ now: at("2026-10-19T22:00:00Z"), bed: BED, mac: { locked: false, idleSeconds: 16 * 60 }, sentTonight: 0 }).ok, true);
});
test("orion-reach: a 10-19 22:33-style wind-down line (variant: phone on the charger, Mac idle 16 min) is dropped", () => {
  const h = bedNight(WIND, { idleSeconds: 16 * 60, locked: false });
  h.setAwareness({ sleep: { state: "awake", inWindow: false, bed: 1440, at: WIND.toISOString() } });
  writeFileSync(join(h.dir, "health-log.json"), JSON.stringify({ phoneSignals: [{ at: "2026-10-19T22:28:18Z", charging: true, motion: "still" }] }));
  const r = h.run("orion-reach", ["Bed at 12:00 AM — ECON1115 at 1:30 PM tomorrow. Start wrapping up.", "--kind", "reminder", "--why", "proactive: bed-wind", "--no-queue"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(h.read("outreach-outbox.jsonl"), []);
  assert.equal(h.read("outreach.jsonl").at(-1).reason, "in-bed");
});

// Review 2026-10-23 (MEDIUM 10): the 30-minute warning is never pushed to a phone he is not holding.
test("orion-reach: the wind-down line with the Mac idle 8 min and no sign the phone is in his hand: not pushed (the 10-19 22:33 push)", () => {
  const h = bedNight(WIND, { idleSeconds: 8 * 60, locked: false });
  h.setAwareness({ sleep: { state: "awake", inWindow: false, bed: 1440, at: WIND.toISOString() } });
  writeFileSync(join(h.dir, "health-log.json"), JSON.stringify({ phoneSignals: [{ at: "2026-10-19T22:28:18Z", charging: false, motion: "still" }] }));
  const r = h.run("orion-reach", ["Bed at 12:00 AM — ECON1115 at 1:30 PM tomorrow. Start wrapping up.", "--kind", "reminder", "--why", "proactive: bed-wind", "--no-queue"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(h.read("outreach-outbox.jsonl"), []);
  assert.match(r.stdout, /phone is not in his hand/);
});
test("orion-reach: the wind-down line with the phone in his hand (screen unlocked 1 min ago) still reaches the phone", () => {
  const h = bedNight(WIND, { idleSeconds: 8 * 60, locked: false });
  h.setAwareness({ sleep: { state: "awake", inWindow: false, bed: 1440, at: WIND.toISOString() } });
  writeFileSync(join(h.dir, "health-log.json"), JSON.stringify({ phoneSignals: [], phoneScreen: { at: "2026-10-19T22:32:41Z", locked: false } }));
  const r = h.run("orion-reach", ["Bed at 12:00 AM — ECON1115 at 1:30 PM tomorrow. Start wrapping up.", "--kind", "reminder", "--why", "proactive: bed-wind", "--no-queue"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(h.read("outreach-outbox.jsonl")[0]?.push, true);
});

// Review 2026-10-23 (LOW 11, 13): the night key by wall clock across the DST change; a malformed health log is "nothing known".
test("nightOf is the wall-clock evening date, also on the night the clocks go back (London, 2026-10-25)", () => {
  assert.equal(nightOf(new Date(2026, 9, 25, 1, 30)), "2026-10-24");
  assert.equal(nightOf(new Date(2026, 9, 25, 5, 59)), "2026-10-24");
  assert.equal(nightOf(new Date(2026, 9, 25, 6, 0)), "2026-10-25");
  assert.equal(nightOf(new Date(2026, 2, 29, 5, 30)), "2026-03-28");   // spring forward
});
test("a health log whose phoneSignals is not an array reads as nothing known", () => {
  const h = bedNight(at("2026-10-19T23:50:00Z"), { idleSeconds: 10, locked: false });
  writeFileSync(join(h.dir, "health-log.json"), JSON.stringify({ phoneSignals: { at: "x" }, phoneScreen: "nope" }));
  const e = readBedtimeEvidence({ dir: h.dir, now: at("2026-10-19T23:50:00Z"), bed: BED, mac: active });
  assert.equal(e.phone, null);
  assert.equal(e.screen, null);
});
