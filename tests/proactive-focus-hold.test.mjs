// 2026-10-16 audit, "Suppression during focus": check-ins, the morning brief, Discord heads-ups and watchers
// ignored an active focus session. Non-urgent ones are held (batched) until it ends; a class he is about to
// miss and a reminder he set still get through.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { mergeHeld } from "../scripts/lib/reach/held.mjs";

const servers = [];
after(() => { for (const s of servers) s.kill(); });

async function harness({ session = "running" } = {}) {
  const home = mkdtempSync(join(tmpdir(), "orion-focus-"));
  const dir = join(home, ".openclaw/orion-controlled"); mkdirSync(dir, { recursive: true });
  const sock = join(home, "s.sock"), replyFile = join(home, "reply.json");
  writeFileSync(replyFile, JSON.stringify({ status: session }));
  const server = spawn(process.execPath, [join(import.meta.dirname, "fixtures/fake-session-server.mjs"), sock], { env: { ...process.env, FAKE_SESSION_REPLY: replyFile } });
  servers.push(server);
  await new Promise((res) => server.stdout.once("data", res));
  const fakeOpen = join(home, "fake-open"); writeFileSync(fakeOpen, "#!/bin/sh\nexit 0\n"); chmodSync(fakeOpen, 0o755);
  writeFileSync(join(home, "config.json"), JSON.stringify({ bedtime: "23:59", usualWake: "00:01" }));
  writeFileSync(join(home, "cal.json"), "[]");
  const env = { PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(home, "config.json"), ORION_SESSION_SOCKET: sock,
    ORION_REACH_FACTS: JSON.stringify({ idleSeconds: 9999, locked: true }), ORION_REACH_OPEN_BIN: fakeOpen,
    ORION_BRIDGE_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"), ORION_CHECKIN_FILE: join(home, "checkins.json"),
    ORION_REACH_NOW: new Date(2026, 9, 16, 14, 0).toISOString() };
  const script = (n) => join(import.meta.dirname, "../scripts", n);
  return { home, dir, env, script, end: () => writeFileSync(replyFile, JSON.stringify({ status: "none" })),
    run: (name, args, extra = {}) => spawnSync(process.execPath, [script(name), ...args], { encoding: "utf8", env: { ...env, ...extra } }),
    outbox: (f = "outreach-outbox.jsonl") => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []) };
}

test("merging held messages: one message, stale and expiring ones left out", () => {
  const now = Date.parse("2026-10-16T14:00:00Z");
  const e = (text, extra = {}) => ({ id: text, at: "2026-10-16T13:00:00Z", text, ...extra });
  assert.equal(mergeHeld([e("Rain at 3.")], { now }).text, "Rain at 3.");
  assert.equal(mergeHeld([e("Rain at 3."), e("Gym at 5.")], { now }).text, "While you were out of reach: Rain at 3. Gym at 5.");
  assert.equal(mergeHeld([e("Bed soon.", { expires: true })], { now }).text, null);
  assert.equal(mergeHeld([{ ...e("Old."), at: "2026-10-15T20:00:00Z" }], { now }).text, null);
});

test("orion-reach: a non-urgent message during a focus session is held and queued, a class message is not", async () => {
  const h = await harness();
  const held = h.run("orion-reach", ["Heads up: rain at 3.", "--kind", "info"]);
  assert.match(held.stdout, /Held/, held.stderr);
  assert.match(held.stdout, /focus session/);
  assert.equal(h.outbox().length, 0);
  assert.equal(h.outbox("held.jsonl").length, 1);
  const cls = h.run("orion-reach", ["Leave in 10 min for CS1800.", "--kind", "reminder", "--urgent-kind", "class"]);
  assert.match(cls.stdout, /^Sent/);
});

test("the morning brief waits for the end of a session, then goes out merged", async () => {
  const h = await harness();
  const during = h.run("orion-reach", ["Morning, Nick. Anything you want to change?", "--kind", "morning", "--awake"]);
  assert.match(during.stdout, /Held/);
  h.end();
  const after = h.run("orion-reach", ["--drain-held"]);
  assert.match(after.stdout, /^Sent/, after.stdout + after.stderr);
  assert.match(h.outbox()[0].text, /Morning, Nick/);
  assert.equal(h.outbox("held.jsonl").length, 0, "released once");
});

test("orion-checkin: a check-in he set still fires once during a session (review M6); the escalation waits (see proactive-review-fixes)", async () => {
  const h = await harness();
  const nowMin = Math.floor(Date.now() / 60000);
  const loop = { blockId: "ci-1", phase: "waiting", level: 0, nextCheckAt: nowMin - 5, deferrals: 0, history: [] };
  writeFileSync(h.env.ORION_CHECKIN_FILE, JSON.stringify({ checkins: [{ id: "ci-1", what: "start the DS lab write-up", dueAt: nowMin - 5, createdAt: new Date().toISOString(), alerts: 0, returning: null, loop }] }));
  const during = h.run("orion-checkin", ["tick", "--json"]);
  assert.equal(JSON.parse(during.stdout).length, 1);
});

test("orion-notify: a non-urgent Discord update during a session is deferred; blocked still goes", async () => {
  const h = await harness();
  const bin = join(h.home, "discord"); writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${h.home}/discord.log"\n`); chmodSync(bin, 0o755);
  const env = { ORION_DISCORD_ALERT_BIN: bin };
  const a = h.run("orion-notify", ["milestone", "standing-check", "Evening digest", "--now", "2026-10-16T14:00:00"], env);
  assert.match(a.stdout, /deferred \(focus session/);
  assert.equal(existsSync(join(h.home, "discord.log")), false);
  const b = h.run("orion-notify", ["blocked", "standing-check", "Starts in 20 min", "--now", "2026-10-16T14:00:00"], env);
  assert.match(b.stdout, /sent/);
});

test("orion-watch: its alerts wait in the focus queue during a session (a class reminder does not)", async () => {
  const h = await harness();
  const day = new Date(); const at = (hh, mm) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm).toISOString();
  writeFileSync(join(h.home, "cal.json"), JSON.stringify([{ identifier: "cs", title: "CS1800 Discrete Structures — Lecture", start: at(9, 0), end: at(10, 30) }]));
  writeFileSync(join(h.home, "watch.json"), "{}");
  const r = h.run("orion-watch", ["tick", "--at", "08:52"], { ORION_WATCH_FILE: join(h.home, "watch.json"), ORION_HEALTH_LOG: join(h.dir, "health-log.json") });
  assert.equal(r.status, 0, r.stderr);
  const sent = h.outbox("alerts-outbox.jsonl").map((a) => a.id);
  assert.ok(sent.some((id) => id.startsWith("class-")), `class reminder goes out: ${sent}`);
  assert.ok(!sent.includes("watch-morning") && !sent.includes("watch-brief"), "the morning question waits");
  assert.ok(h.outbox("held.jsonl").some((e) => /^Morning\./.test(e.text) && e.via === "alerts-outbox"), "and is queued, not dropped");
});
