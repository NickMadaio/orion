// 2026-10-16 proactive-messaging audit, finding 4: quiet hours never fired
// (presence.mjs waited for a sleep state "night" that is never produced; a
// non-urgent push went out at 03:09). Pure rules first, then the CLI end to end
// against a temp HOME and a fake "open" so nothing real is sent.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isQuietNow, sleepWindowFor, bypassesQuiet, isUrgentNotification } from "../scripts/lib/reach/quiet.mjs";
import { chooseChannel } from "../scripts/lib/reach/route.mjs";

const m = (h, mm = 0) => h * 60 + mm;

test("quiet from bedtime to wake, and not outside it", () => {
  const w = { bed: m(24), wake: m(7, 15) };
  assert.equal(isQuietNow({ minute: m(3, 9), ...w }), true);
  assert.equal(isQuietNow({ minute: m(7, 30), ...w }), false);
  assert.equal(isQuietNow({ minute: m(14), ...w }), false);
  assert.equal(isQuietNow({ minute: m(23, 50), bed: m(23, 45), wake: m(7) }), true);
});

test("he is already up (woke earlier than the alarm): not quiet", () => {
  assert.equal(isQuietNow({ minute: m(6, 40), bed: m(24), wake: m(7, 15), wokeAt: m(6, 20) }), false);
});

test("a late bed (00:30) does not make 00:10 quiet yet", () => {
  assert.equal(isQuietNow({ minute: m(0, 10), bed: m(24, 30), lastBed: m(24, 30), wake: m(9) }), false);
});

test("the window comes from night.json, then sleep-actual, then the life config", () => {
  const config = { bedtime: "00:00", usualWake: "09:00" };
  assert.deepEqual(sleepWindowFor({ date: "2026-10-16", config, night: null, nights: [] }), { bed: 1440, wake: 540, lastBed: null, wokeAt: null });
  const night = { days: [{ date: "2026-10-15", bed: 1440 }, { date: "2026-10-16", plannedWake: 435, wake: 435, bed: 1440 }] };
  assert.equal(sleepWindowFor({ date: "2026-10-16", config, night, nights: [] }).wake, 435);
  const nights = [{ fellAsleep: "2026-10-16T01:00:00", wokeAt: "2026-10-16T05:30:00" }];
  assert.equal(sleepWindowFor({ date: "2026-10-16", config, night, nights }).wokeAt, 330);
});

test("only a reminder he set, or a class he is about to miss, may bypass quiet hours", () => {
  assert.equal(bypassesQuiet({ urgentKind: "reminder" }), true);
  assert.equal(bypassesQuiet({ urgentKind: "class" }), true);
  for (const kind of ["bedtime", "checkin", "nudge", null]) assert.equal(bypassesQuiet({ urgentKind: kind }), false, String(kind));
});

test("the phone sees it as urgent only for the flag AND a genuine kind", () => {
  assert.equal(isUrgentNotification({ urgent: true, urgentKind: "class" }), true);
  assert.equal(isUrgentNotification({ urgent: true }), false, "a bare --urgent is not enough any more");
  assert.equal(isUrgentNotification({ urgent: false, urgentKind: "class" }), false);
});

test("route: quiet holds, unless a genuinely urgent kind", () => {
  const f = { idleSeconds: 9999, quiet: true };
  assert.equal(chooseChannel(f).channel, "hold");
  assert.equal(chooseChannel(f, { urgent: true }).channel, "hold", "a bare urgent flag does not bypass");
  assert.equal(chooseChannel(f, { urgent: true, urgentKind: "bedtime" }).channel, "hold");
  assert.equal(chooseChannel(f, { urgent: true, urgentKind: "class" }).channel, "phone");
  assert.equal(chooseChannel(f, { urgent: true, urgentKind: "reminder" }).channel, "phone");
});

test("route: awake at the Mac inside the sleep window is never aloud", () => {
  assert.equal(chooseChannel({ idleSeconds: 5, lateAwake: true }).channel, "mac-bubble");
});

// ---- the CLI, end to end ------------------------------------------------------
function harness() {
  const home = mkdtempSync(join(tmpdir(), "orion-quiet-"));
  const dir = join(home, "controlled");
  const opened = join(home, "opened.log");
  const fakeOpen = join(home, "fake-open");
  writeFileSync(fakeOpen, `#!/bin/sh\necho "$@" >> "${opened}"\n`); chmodSync(fakeOpen, 0o755);
  writeFileSync(join(home, "config.json"), JSON.stringify({ bedtime: "00:00", usualWake: "09:00" }));
  writeFileSync(join(home, "cal.json"), "[]");
  const run = (args, { at = "2026-10-16T03:09:00", facts = { idleSeconds: 9999, locked: true } } = {}) =>
    spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/orion-reach"), ...args], { encoding: "utf8", env: {
      PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(home, "config.json"),
      ORION_REACH_NOW: new Date(at).toISOString(), ORION_REACH_FACTS: JSON.stringify(facts), ORION_REACH_OPEN_BIN: fakeOpen,
      ORION_BRIDGE_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"),
      ORION_SESSION_SOCKET: join(home, "no.sock") } });
  const outbox = () => (existsSync(join(dir, "outreach-outbox.jsonl")) ? readFileSync(join(dir, "outreach-outbox.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { run, outbox, dir };
}

test("incident 2026-10-16 03:09: a non-urgent push at 3 AM is held, not sent", () => {
  const h = harness();
  const r = h.run(["Session done. Next: MKTG2201 at 1:30 PM.", "--kind", "update"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /[Hh]eld/);
  assert.equal(h.outbox().length, 0, "nothing reached the phone");
  assert.ok(existsSync(join(h.dir, "held.jsonl")), "queued for the morning, not dropped");
});

test("a bare --urgent bedtime nag at 3 AM is still held", () => {
  const h = harness();
  const r = h.run(["It's 3:09 AM, bedtime.", "--kind", "reminder", "--urgent"]);
  assert.match(r.stdout, /[Hh]eld/);
  assert.equal(h.outbox().length, 0);
});

test("a class he is about to miss gets through at night, and is marked urgent in the outbox", () => {
  const h = harness();
  const night = h.run(["Leave in 10 min for CS1800 at 9:00 AM.", "--kind", "reminder", "--urgent", "--urgent-kind", "class"]);
  assert.equal(night.status, 0, night.stderr);
  const [line] = h.outbox();
  assert.equal(line.push, true);
  assert.equal(line.urgent, true);
});

test("the outbox line carries urgent:false unless the kind is genuinely urgent", () => {
  const h = harness();
  h.run(["Rain at 3", "--kind", "info"], { at: "2026-10-16T14:00:00" });
  h.run(["Bed soon", "--kind", "reminder", "--urgent"], { at: "2026-10-16T14:00:00" });
  const lines = h.outbox();
  assert.equal(lines.length, 2);
  assert.equal(lines[0].urgent, false);
  assert.equal(lines[1].urgent, false, "bare --urgent is not a genuinely urgent kind");
});

test("daytime sends are not held", () => {
  const h = harness();
  const r = h.run(["Gym at 5.", "--kind", "info"], { at: "2026-10-16T14:00:00" });
  assert.match(r.stdout, /^Sent/);
  assert.equal(h.outbox().length, 1);
});
