// W10-A1: every notification and proactive message is also in the phone chat line and the Mac chat, and his reply binds to it.
// orion-reach --log-only, the senders that bypass orion-reach, check-in ticks, and the reply side (channel preference, away window).
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { harness, SCRIPTS } from "./delivery-helpers.mjs";
import { pickOutreach, surfaceOf, deliveredRows } from "../scripts/lib/reach/reply-context.mjs";
import { logOutreach } from "../scripts/lib/reach/log-outreach.mjs";

const NOW = new Date("2026-11-02T15:00:00Z");

test("orion-reach --already-sent records the row and a chat-only outbox line: no push, no app open, idempotent by id", () => {
  const h = harness();
  const args = ["It will rain at 4 PM, bring a jacket.", "--already-sent", "discord", "--kind", "update", "--why", "weather-alert", "--id", "wx-1"];
  const first = h.run("orion-reach", args);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(h.run("orion-reach", args).status, 0);
  const rows = h.read("outreach.jsonl");
  assert.equal(rows.length, 1, "logged once");
  assert.equal(rows[0].id, "wx-1");
  assert.equal(rows[0].channel, "discord");
  assert.equal(rows[0].kind, "update");
  assert.equal(rows[0].text, "It will rain at 4 PM, bring a jacket.");
  const out = h.read("outreach-outbox.jsonl");
  assert.equal(out.length, 1);
  assert.equal(out[0].push, false, "never a second notification");
  assert.equal(out[0].id, "wx-1");
  assert.equal(h.lines("open.log").length, 0, "no hologram or app open");
  assert.equal(deliveredRows(readFileSync(join(h.dir, "outreach.jsonl"), "utf8")).length, 1, "reply-context counts it as delivered");
});

test("--log-only needs no gate: it is recorded during a focus session and at 3 AM", () => {
  const h = harness();
  h.setAwareness({ session: { state: "focus", at: new Date().toISOString() }, sleep: { state: "asleep", at: new Date().toISOString() } }, new Date());
  const r = h.run("orion-reach", ["Mission m1 finished.", "--log-only", "--kind", "info"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(h.read("outreach.jsonl").length, 1);
  assert.equal(h.read("outreach-outbox.jsonl")[0].push, false);
});

test("orion-notify records what it delivered (and not what it only deferred)", () => {
  const h = harness();
  const bin = join(h.home, "discord"); writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${h.home}/discord.log"\n`); chmodSync(bin, 0o755);
  h.setAwareness({ session: { state: "none", at: new Date().toISOString() }, sleep: { state: "awake", at: new Date().toISOString() } }, new Date());
  const r = h.run("orion-notify", ["complete", "m-77", "Report is ready", "--now", new Date().toISOString()], { ORION_DISCORD_ALERT_BIN: bin });
  assert.match(r.stdout, /sent/i, r.stdout + r.stderr);
  const log = h.lines("reach.log").join("\n");   // the message is two lines: head and body
  assert.equal(log.match(/--already-sent/g)?.length, 1, "one chat-line record, no second send");
  assert.match(log, /Orion \| MISSION COMPLETE \| m-77\nReport is ready --already-sent discord/);
  assert.doesNotMatch(log, /--channel phone/);
});

test("orion-cron-deliver records a Discord delivery; a failed delivery records nothing", () => {
  for (const code of [0, 1]) {
    const h = harness();
    const alert = join(h.home, "Desktop/ORION/scripts"); mkdirSync(alert, { recursive: true });
    writeFileSync(join(alert, "orion-discord-alert"), `#!/bin/sh\nexit ${code}\n`, { mode: 0o755 });
    const r = spawnSync(process.execPath, [join(SCRIPTS, "orion-cron-deliver"), "--label", "wx", "--", "/bin/sh", "-c", "echo Daily digest ready"], { encoding: "utf8", env: { ...h.env, HOME: h.home } });
    const calls = h.lines("reach.log");
    if (code === 0) { assert.equal(r.status, 0, r.stderr); assert.equal(calls.length, 1); assert.match(calls[0], /Daily digest ready.*--already-sent discord/); }
    else assert.ok(calls.every((c) => !/--already-sent/.test(c)), "nothing logged as sent");
  }
});

test("orion-approve-resume records its Mac-only banner in the chat", () => {
  const h = harness();
  const osa = join(h.home, "fake-osa"); writeFileSync(osa, "#!/bin/sh\nexit 0\n"); chmodSync(osa, 0o755);
  const r = spawnSync(process.execPath, [join(SCRIPTS, "orion-approve-resume"), "ap-9", "send the file"], { encoding: "utf8", env: { ...h.env, ORION_OSASCRIPT_BIN: osa } });
  assert.equal(r.status ?? 0, 0, r.stderr);
  const calls = h.lines("reach.log");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /Approved ap-9/);
  assert.match(calls[0], /--already-sent mac-notification/);
});

test("a check-in tick records its alert as outreach under the phone-thread id, with a chat-only outbox line", () => {
  const h = harness();
  const min = Math.floor(Date.now() / 60000);
  const c = { id: "ci-x", what: "start the lab", by: "nick", dueAt: min - 5, createdAt: new Date().toISOString(), alerts: 0, returning: null,
    loop: { blockId: "ci-x", phase: "waiting", level: 0, nextCheckAt: min - 5, deferrals: 0, history: [] } };
  writeFileSync(h.env.ORION_CHECKIN_FILE, JSON.stringify({ checkins: [c] }));
  h.setAwareness({ session: { state: "none", at: new Date().toISOString() }, sleep: { state: "awake", at: new Date().toISOString() } }, new Date());
  const alerts = JSON.parse(h.run("orion-checkin", ["tick", "--json"]).stdout);
  assert.equal(alerts.length, 1);
  const rows = h.read("outreach.jsonl");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, `checkin-ci-x-${alerts[0].level}`);
  assert.equal(rows[0].text, alerts[0].text);
  assert.equal(rows[0].kind, "checkin");
  assert.equal(h.read("outreach-outbox.jsonl")[0].push, false);
});

test("logOutreach: the same id a day later is a new row; within minutes it is a retry", () => {
  const h = harness();
  const at = (iso) => new Date(iso);
  assert.equal(logOutreach(h.dir, { text: "a", id: "k", now: at("2026-11-02T10:00:00Z") }).duplicate, undefined);
  assert.equal(logOutreach(h.dir, { text: "a", id: "k", now: at("2026-11-02T10:03:00Z") }).duplicate, true);
  assert.equal(logOutreach(h.dir, { text: "a", id: "k", now: at("2026-11-03T10:00:00Z") }).duplicate, undefined);
  assert.equal(logOutreach(h.dir, { text: "  " }).ok, false);
});

// ---- reply side
const row = (id, minsAgo, channel, extra = {}) => ({ id, at: new Date(NOW.getTime() - minsAgo * 60_000).toISOString(), text: `msg ${id}`, kind: "info", channel, ...extra });

test("reply surfaces: a phone reply binds to the phone's message, a Mac reply to the Mac's, both-chat rows to either", () => {
  const rows = [row("p", 8, "phone"), row("m", 2, "mac-bubble")];
  assert.equal(pickOutreach(rows, { now: NOW.getTime(), channel: "phone" })?.id, "p");
  assert.equal(pickOutreach(rows, { now: NOW.getTime(), channel: "mac" })?.id, "m");
  assert.equal(pickOutreach(rows, { now: NOW.getTime() })?.id, "m", "no surface given: the newest");
  const both = [row("p", 8, "phone"), row("d", 2, "discord")];
  assert.equal(pickOutreach(both, { now: NOW.getTime(), channel: "phone" })?.id, "d", "a Discord line is in both chats and newer");
  assert.equal(pickOutreach(both, { now: NOW.getTime(), channel: "mac" })?.id, "d");
  assert.equal(surfaceOf(row("x", 1, "mac-notification")), null);
});

test("a newer question on the other surface is still what he answers", () => {
  const rows = [row("p", 8, "phone"), row("q", 2, "mac-voice", { ask: { type: "mismatch" } })];
  assert.equal(pickOutreach(rows, { now: NOW.getTime(), channel: "phone" })?.id, "q");
});

test("a push sent while he was away is answered up to 2 h later; a Mac bubble or a spoken-over one is not", () => {
  const t = NOW.getTime();
  assert.equal(pickOutreach([row("p", 100, "phone")], { now: t, channel: "phone" })?.id, "p");
  assert.equal(pickOutreach([row("p", 130, "phone")], { now: t, channel: "phone" }), null);
  assert.equal(pickOutreach([row("m", 100, "mac-bubble")], { now: t, channel: "mac" }), null);
  assert.equal(pickOutreach([row("p", 100, "phone")], { now: t, channel: "phone", turns: [t - 30 * 60_000] }), null, "he said something since");
  assert.equal(pickOutreach([row("p", 100, "phone"), row("n", 5, "phone")], { now: t, channel: "phone" })?.id, "n", "something newer happened");
});

test("orion-inbound-turn --source phone injects the phone row, not a newer Mac-only one", () => {
  const h = harness({ now: NOW });
  const rows = [row("p", 8, "phone"), row("m", 2, "mac-bubble")];
  writeFileSync(join(h.dir, "outreach.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const cfg = join(h.home, "oc.json"); writeFileSync(cfg, JSON.stringify({ session: { reset: { mode: "idle", idleMinutes: 45 } } }));
  const sess = join(h.home, "sessions.json"); writeFileSync(sess, JSON.stringify({ "agent:main:s1": { updatedAt: NOW.getTime() - 60_000 } }));
  const bin = join(h.home, "oc"); writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${h.home}/inject.log"\n`); chmodSync(bin, 0o755);
  const env = { ORION_GATEWAY_CONFIG: cfg, ORION_GATEWAY_SESSIONS: sess, ORION_OPENCLAW_BIN: bin };
  const r = h.run("orion-inbound-turn", ["--source", "phone", "--session", "s1", "--text", "yeah", "--inject-by", String(Date.now() + 8000)], env);
  assert.match(r.stdout, /injected p\b/, r.stdout + r.stderr);
  assert.ok(existsSync(join(h.home, "inject.log")));
});
