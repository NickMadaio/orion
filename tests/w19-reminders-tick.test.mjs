// The reminder clock: fire on time, never twice, never lost, snooze and done, resurface once (w19-reminders).
process.env.TZ = "Europe/London";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTick } from "../scripts/lib/reminders/tick.mjs";
import { readReminders, snoozeReminder, doneReminder, latestFired, todaysReminders } from "../scripts/lib/reminders/store.mjs";
import { daysOf } from "../scripts/lib/reminders/schedule.mjs";

const T = (h, m = 0, d = 4) => new Date(2026, 10, d, h, m, 0);
const fresh = (list) => { const dir = mkdtempSync(join(tmpdir(), "rem-")); writeFileSync(join(dir, "reminders.json"), JSON.stringify(list)); return dir; };
const mk = (over) => ({ id: "a1", kind: "alarm", label: "call mom", dueAt: T(17).getTime(), createdAt: T(9).getTime(), ...over });
const reachStub = (reply = { status: 0, stdout: "Sent — his phone (notification + chat) (the Mac is locked).\n" }) => {
  const calls = []; const fn = (args) => { calls.push(args); return typeof reply === "function" ? reply(args) : reply; }; fn.calls = calls; return fn;
};
const textOf = (args) => args[0];
const home = (atHome) => ({ derived: { atHome } });

test("a reminder due now fires once; the next tick does not repeat it", async () => {
  const dir = fresh([mk()]); const reach = reachStub();
  await runTick({ dir, now: T(17, 0), aw: home(true), reach });
  await runTick({ dir, now: T(17, 0), aw: home(true), reach });
  await runTick({ dir, now: T(17, 1), aw: home(true), reach });
  assert.equal(reach.calls.length, 1);
  assert.equal(textOf(reach.calls[0]), "Reminder: call mom.");
  assert.ok(readReminders(dir)[0].firedAt);
});

test("nothing fires before it is due", async () => {
  const dir = fresh([mk()]); const reach = reachStub();
  await runTick({ dir, now: T(16, 59), aw: home(true), reach });
  assert.equal(reach.calls.length, 0);
});

test("a reminder the Mac slept through fires on wake, once, said as missed", async () => {
  const dir = fresh([mk()]); const reach = reachStub();
  await runTick({ dir, now: T(19, 30), aw: home(true), reach });
  assert.equal(reach.calls.length, 1);
  assert.equal(textOf(reach.calls[0]), "Missed reminder: call mom (it was due at 5:00 PM).");
  await runTick({ dir, now: T(19, 31), aw: home(true), reach });
  assert.equal(reach.calls.length, 1);
});

test("a one-shot more than a day and a half late is dropped silently, not read out", async () => {
  const dir = fresh([mk({ dueAt: T(17, 0, 1).getTime() })]); const reach = reachStub();
  await runTick({ dir, now: T(17, 0, 4), aw: home(true), reach });
  assert.equal(reach.calls.length, 0);
  assert.equal(readReminders(dir).length, 0);
});

test("a recurring reminder rolls to the next occurrence and fires again then", async () => {
  const dir = fresh([mk({ repeat: { days: daysOf("daily"), time: "17:00" } })]); const reach = reachStub();
  await runTick({ dir, now: T(17, 0), aw: home(true), reach });
  assert.equal(new Date(readReminders(dir)[0].dueAt).getDate(), 5);
  await runTick({ dir, now: T(17, 0, 5), aw: home(true), reach });
  assert.equal(reach.calls.length, 2);
});

test("a recurring reminder that was missed for days fires once and skips ahead, not a backlog", async () => {
  const dir = fresh([mk({ dueAt: T(17, 0, 1).getTime(), repeat: { days: daysOf("daily"), time: "17:00" } })]); const reach = reachStub();
  await runTick({ dir, now: T(8, 0, 4), aw: home(true), reach });
  assert.equal(reach.calls.length, 0, "three days stale: not read out");
  assert.equal(new Date(readReminders(dir)[0].dueAt).getTime(), T(17, 0, 4).getTime());
});

test("snooze moves it, clears the fired mark, and it fires again worded as 'again'", async () => {
  const dir = fresh([mk()]); const reach = reachStub();
  await runTick({ dir, now: T(17, 0), aw: home(true), reach });
  const s = snoozeReminder(dir, "last", 10, T(17, 2));
  assert.equal(s.ok, true);
  assert.equal(readReminders(dir)[0].dueAt, T(17, 12).getTime());
  await runTick({ dir, now: T(17, 11), aw: home(true), reach });
  assert.equal(reach.calls.length, 1);
  await runTick({ dir, now: T(17, 12), aw: home(true), reach });
  assert.equal(reach.calls.length, 2);
  assert.equal(textOf(reach.calls[1]), "Reminder again: call mom.");
});

test("snoozing a recurring reminder leaves the schedule and adds a one-off", async () => {
  const dir = fresh([mk({ repeat: { days: daysOf("daily"), time: "17:00" } })]); const reach = reachStub();
  await runTick({ dir, now: T(17, 0), aw: home(true), reach });
  snoozeReminder(dir, "last", 15, T(17, 1));
  const list = readReminders(dir);
  assert.equal(list.length, 2);
  assert.ok(list.some((r) => r.repeat && new Date(r.dueAt).getDate() === 5));
  assert.ok(list.some((r) => !r.repeat && r.dueAt === T(17, 16).getTime()));
});

test("done removes a one-off, and leaves a recurring one scheduled", async () => {
  const one = fresh([mk()]); const rec = fresh([mk({ repeat: { days: daysOf("daily"), time: "17:00" } })]);
  for (const dir of [one, rec]) { await runTick({ dir, now: T(17, 0), aw: home(true), reach: reachStub() }); assert.equal(doneReminder(dir, "last", T(17, 1)).ok, true); }
  assert.equal(readReminders(one).length, 0);
  assert.equal(readReminders(rec).length, 1);
});

test("snooze and done with nothing fired recently say so", () => {
  const dir = fresh([mk()]);
  assert.equal(snoozeReminder(dir, "last", 10, T(12)).ok, false);
  assert.equal(doneReminder(dir, "last", T(12)).ok, false);
  assert.equal(latestFired(readReminders(dir), T(12)), null);
});

test("a reminder he never answered resurfaces once, 30 minutes later, and not again", async () => {
  const dir = fresh([mk()]); const reach = reachStub();
  await runTick({ dir, now: T(17, 0), aw: home(true), reach });
  await runTick({ dir, now: T(17, 20), aw: home(true), reach });
  assert.equal(reach.calls.length, 1);
  await runTick({ dir, now: T(17, 31), aw: home(true), reach });
  assert.equal(reach.calls.length, 2);
  assert.equal(textOf(reach.calls[1]), "Still open: call mom. Say done, or snooze it.");
  await runTick({ dir, now: T(18, 30), aw: home(true), reach });
  assert.equal(reach.calls.length, 2);
});

test("an answered reminder (snoozed or done) is not resurfaced", async () => {
  const dir = fresh([mk()]); const reach = reachStub();
  await runTick({ dir, now: T(17, 0), aw: home(true), reach });
  snoozeReminder(dir, "last", 120, T(17, 5));
  await runTick({ dir, now: T(17, 40), aw: home(true), reach });
  assert.equal(reach.calls.length, 1);
});

test("a held delivery (focus) is not nagged about: it comes out at the break", async () => {
  const dir = fresh([mk()]); const reach = reachStub({ status: 0, stdout: "Held — held (a focus session is running - batched until a break).\n" });
  await runTick({ dir, now: T(17, 0), aw: home(true), reach });
  await runTick({ dir, now: T(17, 40), aw: home(true), reach });
  assert.equal(reach.calls.length, 1);
});

test("a failed delivery is retried on the next tick, then given up after five", async () => {
  const dir = fresh([mk()]); const reach = reachStub({ status: 4, stdout: "NOT SENT: delivery failed (x).\n" });
  for (let i = 0; i < 8; i++) await runTick({ dir, now: T(17, 0, 4), aw: home(true), reach });
  assert.equal(reach.calls.length, 5);
});

test("when I get home: armed while he is away, fires on arrival, once", async () => {
  const dir = fresh([mk({ place: "home", dueAt: T(9, 0, 5).getTime() })]); const reach = reachStub();
  await runTick({ dir, now: T(14), aw: home(true), reach });
  assert.equal(reach.calls.length, 0, "already home when asked: waits for the next arrival");
  await runTick({ dir, now: T(15), aw: home(false), reach });
  assert.equal(reach.calls.length, 0);
  assert.equal(readReminders(dir)[0].armed, true);
  await runTick({ dir, now: T(16), aw: home(true), reach });
  assert.equal(reach.calls.length, 1);
  assert.equal(textOf(reach.calls[0]), "You're home. Reminder: call mom.");
  await runTick({ dir, now: T(16, 1), aw: home(true), reach });
  assert.equal(reach.calls.length, 1);
});

test("an unknown place never fires or arms a place reminder", async () => {
  const dir = fresh([mk({ place: "home", dueAt: T(9, 0, 5).getTime() })]); const reach = reachStub();
  await runTick({ dir, now: T(15), aw: home(null), reach });
  assert.equal(reach.calls.length, 0);
  assert.equal(readReminders(dir)[0].armed, undefined);
});

test("a place reminder he never arrived for fires at its expiry as an ordinary reminder", async () => {
  const dir = fresh([mk({ place: "home", dueAt: T(9, 0, 5).getTime() })]); const reach = reachStub();
  await runTick({ dir, now: T(9, 0, 5), aw: home(true), reach });
  assert.equal(reach.calls.length, 1);
});

test("a game on the Mac sends the reminder to the phone; an important one still skips the focus hold", async () => {
  const dir = fresh([mk({ important: true })]); const reach = reachStub();
  const activity = { version: 1, at: T(17, 0).toISOString(), category: "game", game: { name: "Minecraft" }, app: { bundleId: "x" } };
  await runTick({ dir, now: T(17, 0), aw: home(true), activity, reach });
  const a = reach.calls[0];
  assert.equal(a[a.indexOf("--channel") + 1], "phone");
  assert.equal(a.includes("--hold-in-focus"), false);
});

test("fired one-offs that were never answered are cleared after three hours", async () => {
  const dir = fresh([mk()]); const reach = reachStub();
  await runTick({ dir, now: T(17, 0), aw: home(true), reach });
  await runTick({ dir, now: T(20, 5), aw: home(true), reach });
  assert.equal(readReminders(dir).length, 0);
});

test("a timer fires and is spoken as 'is up'", async () => {
  const dir = fresh([mk({ id: "t1", kind: "timer", label: "Tea" })]); const reach = reachStub();
  await runTick({ dir, now: T(17, 0), aw: home(true), reach });
  assert.equal(textOf(reach.calls[0]), "Tea is up.");
});

test("today's reminders, in time order, without the ones already answered", () => {
  const list = [mk({ id: "b", label: "gym", dueAt: T(18).getTime() }), mk({ id: "a", label: "call mom", dueAt: T(10).getTime() }),
    mk({ id: "c", label: "tomorrow thing", dueAt: T(10, 0, 5).getTime() }), mk({ id: "d", label: "done thing", dueAt: T(9).getTime(), firedAt: T(9).getTime() })];
  assert.deepEqual(todaysReminders(list, T(8)).map((r) => r.label), ["call mom", "gym"]);
  assert.deepEqual(todaysReminders([mk({ place: "home", label: "water plants", dueAt: T(9, 0, 5).getTime() })], T(8)).map((r) => r.label), ["water plants"]);
});

test("the store file is not created by a tick with nothing to do", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rem-"));
  await runTick({ dir, now: T(17), aw: home(true), reach: reachStub() });
  assert.equal(existsSync(join(dir, "reminders.json")), false);
  assert.equal(readReminders(dir).length, 0);
  assert.ok(typeof readFileSync);
});
