// 2026-10-16 audit, finding 6: failures recorded as sent.
//  - orion-notify recorded Discord DNS failures in notify.sent (consuming the 30 min
//    dedupe window and the hourly cap) and nothing retried;
//  - "NOT SENT" exited 0, so orion-proactive marked the key as said.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { deliveryOutcome } from "../scripts/lib/reach/delivery.mjs";

test("a key is marked said only when the message was sent, held or already said", () => {
  assert.equal(deliveryOutcome({ status: 0, stdout: "Sent — his phone (x)." }).said, true);
  assert.equal(deliveryOutcome({ status: 0, stdout: "Held — held (quiet)." }).said, true);
  assert.equal(deliveryOutcome({ status: 0, stdout: "Already said: already told him that recently." }).said, true);
  assert.equal(deliveryOutcome({ status: 0, stdout: "NOT SENT: x." }).said, false, "the old exit-0 NOT SENT");
  assert.equal(deliveryOutcome({ status: 3, stdout: "NOT SENT: rate." }).said, false);
  assert.equal(deliveryOutcome({ status: 4, stdout: "NOT SENT: delivery failed." }).failed, true);
  assert.equal(deliveryOutcome({ status: null, stdout: "" }).said, false, "a timeout");
});

const NOW = new Date("2026-10-16T14:00:00");
function notifyHarness({ discordOk, reachOk }) {
  const home = mkdtempSync(join(tmpdir(), "orion-notify-"));
  const bin = (name, body) => { const p = join(home, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); return p; };
  const discord = bin("discord", discordOk ? "echo delivered" : 'echo "Discord alert was not delivered: curl: (6) Could not resolve host: discordapp.com" >&2; exit 1');
  const reach = bin("reach", `echo "$@" >> "${home}/reach.log"; ${reachOk ? 'echo "Sent - his phone"' : 'echo "NOT SENT: delivery failed"; exit 4'}`);
  const run = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/orion-notify"), ...args, "--now", NOW.toISOString()], { encoding: "utf8", env: {
    PATH: process.env.PATH, HOME: home, ORION_DISCORD_ALERT_BIN: discord, ORION_REACH_BIN: reach } });
  const state = () => JSON.parse(readFileSync(join(home, ".openclaw/orion-controlled/remote.json"), "utf8"));
  return { run, state, home };
}

test("incident 2026-10-15: a Discord DNS failure is not recorded as sent", () => {
  const h = notifyHarness({ discordOk: false, reachOk: false });
  const r = h.run("milestone", "standing-check", "Heads up 9:00 AM - CS1800 Discrete Structures. Starts in 1h 58m.");
  assert.notEqual(r.status, 0, "a failed send exits non-zero");
  const s = h.state();
  assert.equal(s.notify.sent.length, 0, "it does not consume the dedupe window or the hourly cap");
  assert.equal(s.notify.retry.length, 1, "it is queued for a retry, never silent");
});

test("Discord down but the phone works: sent through the fallback and said so", () => {
  const h = notifyHarness({ discordOk: false, reachOk: true });
  const r = h.run("milestone", "standing-check", "Evening digest");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /phone/);
  const s = h.state();
  assert.equal(s.notify.sent.length, 1);
  assert.equal(s.notify.sent[0].via, "phone");
  assert.match(readFileSync(join(h.home, "reach.log"), "utf8"), /--channel phone/);
});

test("a queued retry goes out on the next run, once, and a stale one is dropped", () => {
  const h = notifyHarness({ discordOk: false, reachOk: false });
  h.run("milestone", "standing-check", "Fresh one");
  const file = join(h.home, ".openclaw/orion-controlled/remote.json");
  const s = h.state();
  s.notify.retry.push({ event: "milestone", missionId: "standing-check", message: "Starts in 1h 58m", at: NOW.getTime() - 5 * 3600_000 });
  writeFileSync(file, JSON.stringify(s));
  const ok = notifyHarness({ discordOk: true, reachOk: true });
  mkdirSync(join(ok.home, ".openclaw/orion-controlled"), { recursive: true });
  writeFileSync(join(ok.home, ".openclaw/orion-controlled/remote.json"), JSON.stringify(s));
  const r = ok.run("flush");
  assert.equal(r.status, 0, r.stderr);
  const after = ok.state();
  assert.equal(after.notify.retry.length, 0);
  assert.equal(after.notify.sent.length, 1, "the fresh one was re-sent; the 5 h old one was dropped as stale");
});

function cronHarness({ discordOk, reachOk }) {
  const home = mkdtempSync(join(tmpdir(), "orion-cron-"));
  mkdirSync(join(home, "Desktop"), { recursive: true });
  const bin = (name, body) => { const p = join(home, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); return p; };
  const discord = bin("discord", discordOk ? `echo "$@" >> "${home}/discord.log"` : 'echo "curl: (6) Could not resolve host: discordapp.com" >&2; exit 1');
  const reach = bin("reach", `echo "$@" >> "${home}/reach.log"; ${reachOk ? "exit 0" : "exit 4"}`);
  const run = (output) => spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/orion-cron-deliver"), "--label", "t-label", "--", "/bin/echo", output],
    { encoding: "utf8", env: { PATH: process.env.PATH, HOME: home, ORION_DISCORD_ALERT_BIN: discord, ORION_REACH_BIN: reach } });
  return { run, home };
}

test("cron delivery: Discord DNS failure falls back to the phone and is recorded as delivered", () => {
  const h = cronHarness({ discordOk: false, reachOk: true });
  h.run("hello from standing orders");
  assert.match(readFileSync(join(h.home, "reach.log"), "utf8"), /hello from standing orders/);
  assert.match(readFileSync(join(h.home, ".openclaw/orion-controlled/cron-delivery.json"), "utf8"), /hello from standing/);
});

test("cron delivery: both channels failing is recorded as delivery_failed, loudly", () => {
  const h = cronHarness({ discordOk: false, reachOk: false });
  const r = h.run("hello");
  assert.match(r.stderr, /NOT delivered/);
  assert.match(readFileSync(join(h.home, ".openclaw/orion-controlled/cron-delivery-history.jsonl"), "utf8"), /delivery_failed/);
});

test("cron delivery: the OFF TASK log line never goes to his phone (2026-10-16 finding 13)", () => {
  const h = cronHarness({ discordOk: true, reachOk: true });
  h.run("ORION: Claude. You're meant to be on do cert courses.\nOFF TASK: Claude (strike 1) - 128 min left");
  const sent = readFileSync(join(h.home, "discord.log"), "utf8");
  assert.doesNotMatch(sent, /OFF TASK/);
  assert.match(sent, /meant to be on do cert courses/);
});
