// How a due reminder reaches him: channel by presence, focus, game and meeting (w19-reminders).
import test from "node:test";
import assert from "node:assert/strict";
import { deliveryPlan, inGame, inMeeting, freshActivity } from "../scripts/lib/reminders/deliver.mjs";
import { gate } from "../scripts/lib/reach/gate.mjs";

const now = new Date("2026-11-04T17:00:00");
const rem = { id: "a1b2c", kind: "alarm", label: "call mom", dueAt: now.getTime(), createdAt: now.getTime() - 3600000 };
const activity = (over = {}) => ({ version: 1, at: now.toISOString(), idleSeconds: 3, app: { name: "Safari", bundleId: "com.apple.Safari" }, category: "browser", game: null, domain: null, ...over });
const plan = (r, o = {}) => deliveryPlan({ reminder: r, now, reason: "due", activity: activity(), aw: {}, ...o });

test("an ordinary reminder goes through orion-reach as a reminder he set, auto channel, held in focus", () => {
  const p = plan(rem);
  assert.equal(p.text, "Reminder: call mom.");
  assert.ok(p.args.includes("--urgent"));
  assert.ok(p.args.includes("--hold-in-focus"));
  assert.equal(p.args[p.args.indexOf("--kind") + 1], "reminder");
  assert.equal(p.args.includes("--channel"), false);
});

test("an important reminder cuts through focus", () => {
  const p = plan({ ...rem, important: true });
  assert.equal(p.args.includes("--hold-in-focus"), false);
  assert.ok(p.args.includes("--urgent"));
});

test("in a game the reminder goes to the phone, not the Mac speakers", () => {
  const p = plan(rem, { activity: activity({ category: "game", game: { name: "Minecraft", since: now.toISOString() } }) });
  assert.equal(p.args[p.args.indexOf("--channel") + 1], "phone");
  assert.match(p.why, /game/);
});

test("in a meeting (Zoom or a Meet tab) the reminder goes to the phone", () => {
  const zoom = plan(rem, { activity: activity({ app: { name: "zoom.us", bundleId: "us.zoom.xos" }, category: "work" }) });
  assert.equal(zoom.args[zoom.args.indexOf("--channel") + 1], "phone");
  const meet = plan(rem, { activity: activity({ domain: "meet.google.com", category: "browser" }) });
  assert.equal(meet.args[meet.args.indexOf("--channel") + 1], "phone");
  assert.equal(inMeeting(activity(), {}), false);
});

test("a stale activity.json is ignored: no guessing he is in a game", () => {
  const old = activity({ at: new Date(now.getTime() - 5 * 60000).toISOString(), game: { name: "Minecraft" }, category: "game" });
  assert.equal(freshActivity(old, now), null);
  assert.equal(plan(rem, { activity: old }).args.includes("--channel"), false);
  assert.equal(inGame(null), false);
});

test("wording by how it fires: snoozed, missed, still open, arrived", () => {
  assert.equal(plan(rem, { reason: "snoozed" }).text, "Reminder again: call mom.");
  assert.match(plan(rem, { reason: "missed" }).text, /^Missed reminder: call mom \(it was due at 5:00 PM\)\.$/);
  assert.equal(plan(rem, { reason: "nudge" }).text, "Still open: call mom. Say done, or snooze it.");
  assert.equal(plan(rem, { reason: "arrived" }).text, "You're home. Reminder: call mom.");
});

test("a bare 'Alarm' label reads as the time, a timer reads as 'is up'", () => {
  assert.equal(plan({ ...rem, label: "Alarm" }).text, "Reminder: it's 5:00 PM, the time you asked me to remind you.");
  assert.equal(plan({ ...rem, kind: "timer", label: "Tea" }).text, "Tea is up.");
});

test("the gate: a reminder holds in focus unless it is important; both bypass sleep", () => {
  const focus = { session: { state: "focus" }, sleep: { state: "asleep" }, calendar: { state: "unknown" } };
  assert.equal(gate(focus, { kind: "reminder", urgentKind: "reminder", holdInFocus: true }).action, "hold");
  assert.equal(gate(focus, { kind: "reminder", urgentKind: "reminder", holdInFocus: true }).heldFor, "focus");
  assert.equal(gate(focus, { kind: "reminder", urgentKind: "reminder" }).action, "deliver");
  const asleep = { session: { state: "none" }, sleep: { state: "asleep" }, calendar: { state: "unknown" } };
  assert.equal(gate(asleep, { kind: "reminder", urgentKind: "reminder", holdInFocus: true }).action, "deliver");
});

import { allowed, isSetReminder } from "../scripts/lib/reach/route.mjs";

test("a reminder he set is never held by the hourly cap (a lost reminder is the worst failure), only by an exact repeat", () => {
  const NOW = Date.parse("2026-11-04T17:00:00Z");
  const history = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, at: new Date(NOW - (50 - i * 5) * 60000).toISOString(), text: `line ${i}`, channel: "phone" }));
  assert.equal(isSetReminder({ kind: "reminder", why: "a reminder he asked for" }), true);
  assert.equal(isSetReminder({ kind: "reminder", why: "proactive: bed-now" }), false);
  assert.equal(isSetReminder({ kind: "info", why: "a reminder he asked for" }), false);
  assert.equal(allowed("Reminder: call mom.", history, { now: NOW }).ok, false, "control: the cap holds an ordinary line");
  assert.equal(allowed("Reminder: call mom.", history, { now: NOW, capExempt: true }).ok, true);
  assert.equal(allowed("line 5", history, { now: NOW, capExempt: true }).ok, false);
});
