// A held "Heads up 3:30 PM" must never be delivered after 3:30 PM, and a flush must not dump stale items.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { subjectTime, staleReason, partitionDeferred } from "../scripts/lib/notify/stale.mjs";

const local = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
const heads = (at) => ({ event: "milestone", missionId: "standing-check", message: "Heads up 3:30 PM — MKTG2201 Introduction to Marketing", at });

test("subjectTime reads the clock time and rolls to the next day when already past at hold time", () => {
  assert.equal(subjectTime("Heads up 3:30 PM — class", local(30, 9)), local(30, 15, 30));
  assert.equal(subjectTime("Heads up 8:00 AM — class", local(30, 23)), local(31, 8));
  assert.equal(subjectTime("nothing timed here", local(30, 9)), null);
});

test("a heads-up is stale once its time has passed, fresh before it", () => {
  const e = heads(local(30, 11));
  assert.equal(staleReason(e, local(30, 15, 29)), null);
  assert.match(staleReason(e, local(30, 15, 30)), /passed/);
  assert.match(staleReason(e, local(31, 13, 29)), /passed/);
});

test("untimed items expire after 6h unless evergreen", () => {
  const plain = { event: "milestone", missionId: "m", message: "Step done", at: local(30, 9) };
  assert.equal(staleReason(plain, local(30, 14)), null);
  assert.match(staleReason(plain, local(30, 16)), /relevance/);
  assert.equal(staleReason({ ...plain, event: "blocked" }, local(31, 9)), null);
  assert.match(staleReason({ ...plain, validUntil: new Date(local(30, 10)).toISOString() }, local(30, 11)), /validUntil/);
  assert.match(staleReason({ ...plain, at: undefined }, local(30, 11)), /timestamp/);
});

test("partitionDeferred splits fresh from stale without mutating", () => {
  const input = [heads(local(30, 9)), { event: "blocked", missionId: "x", message: "Need input", at: local(31, 12) }];
  const frozen = JSON.stringify(input);
  const { fresh, stale } = partitionDeferred(input, local(31, 13, 29));
  assert.equal(fresh.length, 1);
  assert.equal(stale.length, 1);
  assert.equal(JSON.stringify(input), frozen);
});

test("orion-notify flush: an all-stale queue sends nothing and is cleared", () => {
  const home = mkdtempSync(join(tmpdir(), "orion-stale-"));
  const dir = join(home, ".openclaw/orion-controlled"); mkdirSync(dir, { recursive: true });
  const state = join(dir, "remote.json");
  writeFileSync(state, JSON.stringify({ missions: {}, pending: {}, notify: { sent: [], retry: [], deferred: [heads(local(30, 9))] } }));
  const marker = join(home, "sent.txt");
  const fake = join(home, "reach"); writeFileSync(fake, `#!/bin/sh\necho "$@" >> ${marker}\nexit 0\n`, { mode: 0o755 });
  const env = { PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_REACH_BIN: fake, ORION_DISCORD_ALERT_BIN: fake };
  const run = spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/orion-notify"), "flush", "--now", new Date(local(31, 15, 45)).toISOString()], { encoding: "utf8", env });
  assert.doesNotMatch(run.stdout + run.stderr, /HELD UPDATES/);
  assert.equal(JSON.parse(readFileSync(state, "utf8")).notify.deferred.length, 0, run.stdout + run.stderr);
  let sent = ""; try { sent = readFileSync(marker, "utf8"); } catch {}
  assert.doesNotMatch(sent, /HELD UPDATES|MKTG2201/);
});
