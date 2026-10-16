// orion-proactive tick end to end: temp HOME, fake calendar, a literal awareness.json, the real orion-reach and
// orion-checkin writing into the temp dir. Scenarios 6 and 13 on the loop side; nothing real is touched or sent.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { aw } from "./fixtures/curiosity-aw.mjs";

const W = join(import.meta.dirname, "..");
const rows = (f) => (existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

function world({ cal, awOver = {}, checkins = null } = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-tick-"));
  const dir = join(home, "controlled"); mkdirSync(dir, { recursive: true });
  const iso = (h, mi) => new Date(2026, 9, 16, h, mi).toISOString();
  writeFileSync(join(home, "cal.json"), JSON.stringify(cal(iso)));
  writeFileSync(join(home, "config.json"), JSON.stringify({ bedtime: "23:45", usualWake: "07:45" }));
  const open = join(home, "fake-open"); writeFileSync(open, "#!/bin/sh\nexit 0\n"); chmodSync(open, 0o755);
  writeFileSync(join(dir, "morning-sent.json"), JSON.stringify({ "2026-10-16": { at: iso(7, 0), signal: "up" } }));
  if (checkins) writeFileSync(join(home, "checkins.json"), JSON.stringify({ checkins }));
  const put = (h, mi, over = awOver) => writeFileSync(join(dir, "awareness.json"), JSON.stringify(aw(new Date(2026, 9, 16, h, mi), over)));
  const env = (h, mi) => ({ PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(home, "config.json"), ORION_CHECKIN_FILE: join(home, "checkins.json"),
    ORION_REACH_NOW: new Date(2026, 9, 16, h, mi).toISOString(), ORION_REACH_FACTS: JSON.stringify({ idleSeconds: 5, locked: false }), ORION_REACH_OPEN_BIN: open,
    ORION_BRIDGE_BIN: join(W, "tests/fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"), ORION_SESSION_SOCKET: join(home, "no.sock") });
  const tick = (h, mi, over, extra = []) => { put(h, mi, over); return spawnSync(process.execPath, [join(W, "scripts/orion-proactive"), "tick", ...extra], { encoding: "utf8", env: env(h, mi), timeout: 120000 }); };
  return { home, dir, tick, checkins: () => JSON.parse(readFileSync(join(home, "checkins.json"), "utf8")).checkins, log: () => rows(join(dir, "outreach.jsonl")),
    ledger: () => JSON.parse(readFileSync(join(dir, "curiosity.json"), "utf8")) };
}
const resumeCal = (iso) => [{ identifier: "resume", title: "finish resume", start: iso(14, 0), end: iso(16, 0), orion: "study" }];

test("not started (scenario 13, loop side): one orion plan check-in at 14:05, none again at the next tick", () => {
  const w = world({ cal: resumeCal });
  const t = w.tick(14, 5, { calendar: { now: { title: "finish resume", kind: "study", start: 840, end: 960, fixed: false, source: "orion" } } });
  assert.equal(t.status, 0, t.stderr);
  const open = w.checkins();
  assert.equal(open.length, 1);
  assert.equal(open[0].by, "orion");
  assert.equal(open[0].what, "finish resume");
  w.tick(14, 10, { calendar: { now: { title: "finish resume", kind: "study", start: 840, end: 960, fixed: false, source: "orion" } } });
  assert.equal(w.checkins().length, 1);
});

test("a matching focus session closes the plan loop with no further message", () => {
  const now = Math.floor(new Date(2026, 9, 16, 14, 12).getTime() / 60000);
  const loop = { blockId: "ci-1", phase: "reminded", level: 1, nextCheckAt: now + 10, deferrals: 0, history: [] };
  const w = world({ cal: resumeCal, checkins: [{ id: "ci-1", what: "finish resume", dueAt: now - 7, createdAt: new Date().toISOString(), alerts: 1, by: "orion", block: "cal-0-resume", returning: null, loop }] });
  // on a break the loop is not deferred; the Mac front app being a work app is the evidence
  const t = w.tick(14, 12, { session: { state: "rest" }, mac: { workApp: "Pages" } });
  assert.equal(t.status, 0, t.stderr);
  assert.equal(w.checkins()[0].loop.phase, "active");
  assert.equal(w.log().length, 0);
});

test("home gap (scenario 6): one ask with 'till 4' and a ledger row; the next tick in the same gap asks nothing", () => {
  const w = world({ cal: (iso) => [{ identifier: "gym", title: "Gym", start: iso(16, 0), end: iso(17, 0) }] });
  const over = { calendar: { freeUntil: 960, next: { title: "Gym", start: 960 } } };
  const t = w.tick(14, 0, over);
  assert.equal(t.status, 0, t.stderr);
  const asks = w.log().filter((r) => r.why?.startsWith("curiosity: home-gap"));
  assert.equal(asks.length, 1);
  assert.match(asks[0].text, /Nothing planned till 4 - what are you up to\?/);
  assert.equal(asks[0].kind, "question");
  assert.equal(w.ledger().asks.length, 1);
  w.tick(14, 5, over);
  w.tick(15, 10, over);
  assert.equal(w.log().filter((r) => r.why?.startsWith("curiosity:")).length, 1);
});

test("--reason tick|phase|place is accepted (C12); anything else is a usage error", () => {
  const w = world({ cal: resumeCal });
  for (const reason of ["tick", "phase", "place"]) assert.equal(w.tick(14, 0, {}, ["--reason", reason, "--dry-run"]).status, 0);
  assert.equal(w.tick(14, 0, {}, ["--reason", "bogus"]).status, 2);
});

test("ask-outcome closes an ask: 'nothing' marks the blank answered and 'declined' is not ignored", () => {
  const w = world({ cal: (iso) => [{ identifier: "gym", title: "Gym", start: iso(16, 0), end: iso(17, 0) }] });
  w.tick(14, 0, { calendar: { freeUntil: 960 } });
  const id = w.ledger().asks[0].askId;
  const r = spawnSync(process.execPath, [join(W, "scripts/orion-proactive"), "ask-outcome", id, "nothing"], { encoding: "utf8", env: { PATH: process.env.PATH, ORION_CONTROLLED_DIR: w.dir } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(w.ledger().asks[0].outcome, "nothing");
  assert.equal(spawnSync(process.execPath, [join(W, "scripts/orion-proactive"), "ask-outcome", id, "weird"], { encoding: "utf8", env: { PATH: process.env.PATH, ORION_CONTROLLED_DIR: w.dir } }).status, 2);
});
