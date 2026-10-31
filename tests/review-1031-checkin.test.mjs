// 2026-10-31 review of the proactive loop, through the real orion-checkin: finding 1 (the re-entered block's second ladder),
// finding 3 (a reply finds its loop from the ladder's own text) and finding 7 (a reply that lands during a tick is not lost).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { world, at, planCheckin } from "./incident-world.mjs";
import { mergeCheckins } from "../scripts/lib/reach/checkin-store.mjs";

const BIN = join(import.meta.dirname, "../scripts/orion-checkin");
const D = 30;
const mins = (d) => Math.floor(d.getTime() / 60000);

function bare(checkins) {
  const home = mkdtempSync(join(tmpdir(), "orion-rv1031-"));
  const file = join(home, "checkins.json");
  writeFileSync(file, JSON.stringify({ checkins }));
  const run = (args, now = at(D, 21, 25)) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home, ORION_CHECKIN_FILE: file, ORION_CONTROLLED_DIR: home, ORION_CHECKIN_NOW: now.toISOString() } });
  return { home, file, run, state: () => JSON.parse(readFileSync(file, "utf8")).checkins };
}
const replanned = (id, what, start, end) => ({ ...planCheckin(id, what, `cal-${id}`, { createdAt: at(D, 17, 5).toISOString(), blockWindow: { date: "2026-10-30", start, end }, phase: "given_up" }),
  ladder: { sent: [], replan: { kind: "moved", start: 1280, end: 1370 }, resolution: { status: "replanned", how: "end", at: at(D, 18, 5).toISOString() } } });
const addArgs = (what, block, start, end) => ["add", "0", what, "--by", "orion", "--block", block, "--day", "2026-10-30", "--start", String(start), "--end", String(end)];

test("finding 1: the block a replan re-entered gets a reprise loop (L0 + END question), never a second full ladder", () => {
  const s = bare([replanned("ci-gym", "Gym", 1020, 1110)]);
  const r = s.run(addArgs("Gym", "cal-gymnew", 1280, 1370));
  assert.equal(r.status, 0, r.stderr);
  const second = s.state().find((c) => c.id !== "ci-gym");
  assert.ok(second, r.stdout);
  assert.equal(second.reprise, true);
  const third = s.run(addArgs("Gym", "cal-gymnewer", 1300, 1390));
  assert.match(third.stdout, /^Already following "Gym" today/, "no third loop for the same title");
  assert.equal(s.state().length, 2);
});

test("finding 3: find falls back to the text before the first '. ' and to a loop whose title starts the text", () => {
  const s = bare([planCheckin("ci-gym", "Gym", "cal-g", { createdAt: at(D, 17, 5).toISOString(), phase: "reminded" })]);
  for (const what of ["Gym. Gym: 0 of the last 6 happened. Not today", "Gym", "gym: 0 of the last 6 happened"]) {
    const r = s.run(["find", "--what", what]);
    assert.equal(r.status, 0, `${what}: ${r.stdout}`);
    assert.equal(JSON.parse(r.stdout).id, "ci-gym");
  }
  assert.equal(s.run(["find", "--what", "Gymnastics practice"]).status, 1, "a longer word is not the title");
});

test("finding 7: merge by id keeps a reply that landed while the tick held the file", () => {
  const base = { checkins: [{ id: "a", what: "Gym", loop: { phase: "reminded" }, alerts: 1, ladder: { sent: [{ msgId: "a-L0" }] } }, { id: "b", what: "Study", loop: { phase: "waiting" }, alerts: 0 }] };
  const ours = { checkins: [{ ...base.checkins[0], alerts: 2, ladder: { sent: [{ msgId: "a-L0" }, { msgId: "a-L1" }] } }, base.checkins[1]] };
  const disk = { checkins: [base.checkins[0], { ...base.checkins[1], loop: { phase: "deferred" } }, { id: "c", what: "new", loop: { phase: "waiting" } }] };
  const merged = mergeCheckins(base, ours, disk);
  assert.deepEqual(merged.checkins.map((c) => c.id), ["a", "b", "c"]);
  assert.equal(merged.checkins[0].alerts, 2, "the tick's own change");
  assert.equal(merged.checkins[1].loop.phase, "deferred", "his reply, made on disk meanwhile");
  // both changed the same loop: his reply wins, and the message the tick sent is still recorded
  const both = mergeCheckins(base, ours, { checkins: [{ ...base.checkins[0], loop: { phase: "active" } }, base.checkins[1]] });
  assert.equal(both.checkins[0].loop.phase, "active");
  assert.deepEqual(both.checkins[0].ladder.sent.map((x) => x.msgId), ["a-L0", "a-L1"]);
});

test("finding 7: 'started' sent while a tick is mid-flight survives the tick's save", () => {
  const GYM = { date: "2026-10-30", start: 1020, end: 1110 };
  const w = world({ day: D, checkins: [
    planCheckin("ci-gym", "Gym", "cal-gym", { createdAt: at(D, 17, 5).toISOString(), nextCheckAt: mins(at(D, 17, 5)), blockWindow: GYM, tier: "protected" }),
    planCheckin("ci-res", "finish resume", "cal-res", { createdAt: at(D, 17, 0).toISOString(), nextCheckAt: mins(at(D, 19, 0)), blockWindow: { date: "2026-10-30", start: 1140, end: 1230 } }),
  ] });
  // orion-reach, while the tick waits on it, is when his "started" on the other loop lands
  const reach = join(w.home, "fake-reach");
  writeFileSync(reach, `#!/bin/sh\n"${process.execPath}" "${BIN}" started ci-res >/dev/null 2>&1\necho "Sent - fake"\n`); chmodSync(reach, 0o755);
  const r = w.run("orion-checkin", ["tick", "--json"], 17, 5, { extra: { ORION_REACH_BIN: reach } });
  assert.equal(r.status, 0, r.stderr);
  const after = w.checkins();
  assert.equal(after.find((c) => c.id === "ci-res").loop.phase, "active", "the reply was overwritten by the tick's blind save");
  assert.equal(after.find((c) => c.id === "ci-gym").ladder.sent.length, 1);
});
