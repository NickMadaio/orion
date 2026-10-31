// REV2 finding 16 (2026-10-31): a mission result with a clock in it ("Mission complete: report ready at 9am") was dropped as stale; a
// heads-up held just after its time rolled to tomorrow and stayed fresh; a held entry without a message crashed the flush.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { staleReason } from "../scripts/lib/notify/stale.mjs";

const local = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();

test("a mission result is evergreen, whatever clock it mentions", () => {
  for (const [event, message] of [["complete", "Mission complete: report ready at 9am"], ["milestone", "Mission complete: the essay draft is in your folder, started at 9am"], ["blocked", "Mission blocked at 2pm: need your login"]]) {
    assert.equal(staleReason({ event, missionId: "m", message, at: local(30, 8) }, local(30, 13)), null, message);
  }
});

test("a heads-up held just after its time is stale, not tomorrow's", () => {
  for (const [message, heldH, heldM] of [["Heads up 3:30 PM — MKTG2201", 15, 35], ["Leave at 1:05 PM for marketing", 13, 30], ["Heads up 9:00 AM — gym", 11, 0]]) {
    assert.match(staleReason({ event: "milestone", missionId: "s", message, at: local(30, heldH, heldM) }, local(30, heldH, heldM + 1)) ?? "", /passed/, message);
  }
  // Held late at night about the morning: tomorrow's, still fresh.
  assert.equal(staleReason({ event: "milestone", missionId: "s", message: "Heads up 8:00 AM — class", at: local(30, 23) }, local(31, 4)), null);
});

test("orion-notify flush survives a held entry with no message", () => {
  const home = mkdtempSync(join(tmpdir(), "orion-stale2-"));
  const dir = join(home, ".openclaw/orion-controlled"); mkdirSync(dir, { recursive: true });
  const state = join(dir, "remote.json");
  writeFileSync(state, JSON.stringify({ missions: {}, pending: {}, notify: { sent: [], retry: [], deferred: [{ event: "milestone", missionId: "x", at: local(30, 1) }] } }));
  const fake = join(home, "reach"); writeFileSync(fake, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const env = { PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_REACH_BIN: fake, ORION_DISCORD_ALERT_BIN: fake };
  const run = spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/orion-notify"), "flush", "--now", new Date(local(31, 15, 45)).toISOString()], { encoding: "utf8", env });
  assert.doesNotMatch(run.stderr, /TypeError|Cannot read/, run.stderr);
  assert.equal(JSON.parse(readFileSync(state, "utf8")).notify.deferred.length, 0, run.stdout + run.stderr);
});
