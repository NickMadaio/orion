// Integration review (2026-10-16), items 2, 3, 4 and 11: real payload shapes, each test fails on the code before its fix.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { harness, NOW } from "./delivery-helpers.mjs";
import { deliveryOutcome } from "../scripts/lib/reach/delivery.mjs";
import { countedToday } from "../scripts/lib/reach/route.mjs";

const focus = { session: { state: "focus", at: NOW.toISOString() } };
const rest = { session: { state: "rest", at: NOW.toISOString() } };
const held = (extra) => `${JSON.stringify({ at: NOW.toISOString(), heldFor: "focus", ...extra })}\n`;
const rows = (h, f) => h.read(f);

test("2: a drain releases held watcher alerts to the alerts outbox and clears only what it delivered", () => {
  const h = harness(); h.setAwareness(rest);
  writeFileSync(join(h.dir, "held.jsonl"), held({ id: "m1", text: "Rain at 3.", kind: "info" })
    + held({ id: "a1", alertId: "watch-1", text: "Class in 20.", level: 2, via: "alerts-outbox" }));
  const r = h.run("orion-reach", ["--drain-held", "--reason", "break"]);
  assert.match(r.stdout, /^Sent/, r.stdout + r.stderr);
  assert.deepEqual(rows(h, "outreach-outbox.jsonl").map((x) => x.text), ["Rain at 3."]);
  assert.deepEqual(rows(h, "alerts-outbox.jsonl").map((x) => [x.id, x.text]), [["watch-1", "Class in 20."]]);
  assert.equal(rows(h, "held.jsonl").length, 0);
});

test("2: only alerts held: the break releases them (nothing is merged, nothing is lost)", () => {
  const h = harness(); h.setAwareness(rest);
  writeFileSync(join(h.dir, "held.jsonl"), held({ id: "a1", alertId: "watch-1", text: "Class in 20.", level: 2, via: "alerts-outbox" }));
  assert.match(h.run("orion-reach", ["--drain-held", "--reason", "break"]).stdout, /^Sent/);
  assert.equal(rows(h, "alerts-outbox.jsonl").length, 1);
  assert.equal(rows(h, "outreach-outbox.jsonl").length, 0);
  assert.equal(rows(h, "held.jsonl").length, 0);
});

test("2: a drain that the gate refuses (still in focus) leaves the alerts where they are", () => {
  const h = harness(); h.setAwareness(focus);
  writeFileSync(join(h.dir, "held.jsonl"), held({ id: "a1", alertId: "watch-1", text: "Class in 20.", via: "alerts-outbox" }));
  assert.match(h.run("orion-reach", ["--drain-held"]).stdout, /Still held/);
  assert.equal(rows(h, "held.jsonl").length, 1);
  assert.equal(existsSync(join(h.dir, "alerts-outbox.jsonl")), false);
});

test("3: a held ask exits 3 as NOT SENT, so the loop records nothing and arms no reply link", () => {
  const h = harness(); h.setAwareness(focus);
  const ask = JSON.stringify({ type: "mismatch", blockId: "b1", title: "finish resume" });
  const r = h.run("orion-reach", ["Time to start: resume.", "--kind", "question", "--ask", ask]);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /^NOT SENT: held/);
  const outcome = deliveryOutcome({ status: r.status, stdout: r.stdout });
  assert.equal(outcome.said, false);
  assert.equal(outcome.refused, true);
  assert.equal(rows(h, "held.jsonl").length, 0, "an ask is never queued");
});

const reachBin = (h, body) => { const p = join(h.home, "reach-x"); writeFileSync(p, `#!/bin/sh\necho "$@" >> "${h.home}/reach.log"\n${body}\n`); chmodSync(p, 0o755); return p; };
const min = () => Math.floor(Date.now() / 60000);
const due = (h) => { const s = JSON.parse(readFileSync(h.env.ORION_CHECKIN_FILE, "utf8")); for (const c of s.checkins) c.loop.nextCheckAt = min() - 1; writeFileSync(h.env.ORION_CHECKIN_FILE, JSON.stringify(s)); };
const open = (h) => h.setAwareness({ session: { state: "none", at: new Date().toISOString() }, sleep: { state: "awake", at: new Date().toISOString() } }, new Date());

test("4: alerts that were not delivered are not counted, and the plan loop never rewrites the calendar", () => {
  const h = harness(); open(h);
  const env = { ORION_REACH_BIN: reachBin(h, 'echo "NOT SENT: held (a focus session is running); an ask is not queued."; exit 3') };
  h.run("orion-checkin", ["add", "0", "finish resume", "--by", "orion", "--block", "blk-1"]);
  for (let i = 0; i < 7; i++) { due(h); open(h); h.run("orion-checkin", ["tick", "--json"], env); }
  const c = JSON.parse(readFileSync(h.env.ORION_CHECKIN_FILE, "utf8")).checkins[0];
  assert.equal(c.alerts, 0);
  assert.notEqual(c.loop.phase, "given_up");
  assert.equal(h.lines("reschedule.log").length, 0, "no displace without an alert that reached him");
});

test("4: the same block re-entered under a new calendar id does not start a second loop that day", () => {
  const h = harness(); open(h);
  h.run("orion-checkin", ["add", "10", "finish resume", "--by", "orion", "--block", "cal-3-aaa"]);
  const again = h.run("orion-checkin", ["add", "10", "finish resume", "--by", "orion", "--block", "cal-7-bbb"]);
  assert.match(again.stdout, /Already following/);
  assert.equal(JSON.parse(readFileSync(h.env.ORION_CHECKIN_FILE, "utf8")).checkins.length, 1);
});

test("11: two drains at once cannot both send", () => {
  const h = harness(); h.setAwareness(rest);
  writeFileSync(join(h.dir, "held.jsonl"), held({ id: "m1", text: "Rain at 3." }));
  writeFileSync(join(h.dir, "held.drain.lock"), "999");
  assert.match(h.run("orion-reach", ["--drain-held"]).stdout, /Another drain is running/);
  assert.equal(rows(h, "outreach-outbox.jsonl").length, 0);
});

test("11: a reach logged twice (app down, fell back to the phone) counts once toward the ceiling", () => {
  const day = "2026-10-16";
  const row = (id, channel) => ({ id, at: `${day}T12:00:00`, why: "proactive: x", channel });
  const local = (d) => d.toLocaleDateString("en-CA");
  assert.equal(countedToday([row("r1", "mac-bubble"), row("r1", "phone"), row("r2", "phone")], day, local), 2);
});

test("11: --loud is aloud only at home or in headphones, except the morning brief", () => {
  const h = harness({ facts: { idleSeconds: 5, locked: false, headphones: false } });
  const away = { location: { state: "elsewhere", placeId: null, since: null, at: NOW.toISOString(), source: "sample" } };
  const atHome = { location: { state: "home", placeId: "home", since: null, at: NOW.toISOString(), source: "sample" } };
  const channel = (loc, kind) => { h.setAwareness(loc); return JSON.parse(h.run("orion-reach", ["Heads up.", "--kind", kind, "--loud", "--json", "--dry-run"]).stdout).channel; };
  assert.equal(channel(away, "info"), "mac-bubble");
  assert.equal(channel(atHome, "info"), "mac-voice");
  assert.equal(channel(atHome, "morning"), "mac-voice");
});

// ---- 5: the ledger is merged, not overwritten ---------------------------------------------------------------------
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { aw as awFixture } from "./fixtures/curiosity-aw.mjs";

test("5: a pause set while a tick is running survives the tick's write; the tick's ask is still recorded", () => {
  const W = join(import.meta.dirname, "..");
  const home = mkdtempSync(join(tmpdir(), "orion-ledger-"));
  const dir = join(home, "controlled"); mkdirSync(dir, { recursive: true });
  const iso = (hh, mi) => new Date(2026, 9, 16, hh, mi).toISOString();
  writeFileSync(join(home, "cal.json"), JSON.stringify([{ identifier: "gym", title: "Gym", start: iso(16, 0), end: iso(17, 0) }]));
  writeFileSync(join(home, "config.json"), JSON.stringify({ bedtime: "23:45", usualWake: "07:45" }));
  writeFileSync(join(dir, "morning-sent.json"), JSON.stringify({ "2026-10-16": { at: iso(7, 0), signal: "up" } }));
  writeFileSync(join(dir, "awareness.json"), JSON.stringify(awFixture(new Date(2026, 9, 16, 14, 0), { calendar: { freeUntil: 960, next: { title: "Gym", start: 960 } } })));
  const env = { PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(home, "config.json"),
    ORION_REACH_NOW: new Date(2026, 9, 16, 14, 0).toISOString(), ORION_REACH_FACTS: JSON.stringify({ idleSeconds: 5, locked: false }),
    ORION_BRIDGE_BIN: join(W, "tests/fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"), ORION_SESSION_SOCKET: join(home, "no.sock") };
  // While orion-reach runs (after the tick read the ledger), Nick pauses curiosity: a concurrent writer of the same file.
  const fake = join(home, "fake-reach");
  writeFileSync(fake, `#!/bin/sh\n"${process.execPath}" "${join(W, "scripts/orion-awareness")}" curiosity pause --days 3 >/dev/null\necho "Sent - fake"\n`); chmodSync(fake, 0o755);
  const r = spawnSync(process.execPath, [join(W, "scripts/orion-proactive"), "tick"], { encoding: "utf8", env: { ...env, ORION_REACH_BIN: fake }, timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const ledger = JSON.parse(readFileSync(join(dir, "curiosity.json"), "utf8"));
  assert.ok(ledger.pausedUntil, "the pause was not overwritten by the tick");
  assert.equal(ledger.asks.length, 1, "the tick's own ask is recorded");
});

// ---- 7: one ask contract ---------------------------------------------------------------------------------------
import { askKind, withKind, clock } from "../scripts/lib/curiosity/ask.mjs";

test("7: every ask type the loop sends has a reader kind; the block title travels with the id", () => {
  for (const t of ["home-gap", "away-gap", "unknown-place", "fill-blank", "blank"]) assert.equal(askKind(t), "blank", t);
  for (const t of ["mismatch", "off-plan"]) assert.equal(askKind(t), "mismatch", t);
  assert.equal(askKind("save-place"), "save-place");
  assert.equal(withKind({ type: "home-gap" }).kind, "blank");
  assert.equal(clock(840), "14:00");
});

test("7: orion-reach writes kind on the logged row and the outbox row, and a mismatch ask carries its title", () => {
  const h = harness({ facts: { idleSeconds: 9999, locked: true } }); h.setAwareness({});
  h.run("orion-reach", ["Time to start: finish resume.", "--kind", "question", "--ask", JSON.stringify({ type: "mismatch", blockId: "cal-3", title: "finish resume", window: { date: "2026-10-16", start: 840, end: 960 } })]);
  h.run("orion-reach", ["Nothing planned till 4 - what are you up to?", "--kind", "question", "--ask", JSON.stringify({ type: "home-gap", askId: "a9", window: { date: "2026-10-16", start: 840, end: null } })]);
  const log = h.read("outreach.jsonl");
  assert.equal(log[0].ask.kind, "mismatch"); assert.equal(log[0].ask.title, "finish resume");
  assert.equal(log[1].ask.kind, "blank");
  assert.equal(h.read("outreach-outbox.jsonl")[1].ask.kind, "blank");
});

test("7: the phone's context line shows a readable time, the block title and the kind (not 'about 840-now')", async () => {
  const { chmod, mkdir, mkdtemp, readFile, writeFile } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const home = await mkdtemp(join((await import("node:os")).tmpdir(), "orion-askdetail-"));
  const dir = join(home, ".openclaw/orion-controlled"); await mkdir(dir, { recursive: true }); await mkdir(join(home, ".openclaw/workspace"), { recursive: true });
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  await writeFile(join(dir, "outreach.jsonl"), `${JSON.stringify({ id: "reach-1", at, text: "What are you up to?", kind: "question", channel: "phone", ask: { type: "home-gap", kind: "blank", window: { date: "2026-10-16", start: 840, end: null } } })}\n`);
  const keep = join(home, "kept.txt"); const brain = join(home, "fake-openclaw");
  await writeFile(brain, `#!/bin/bash\nprev=""\nfor a in "$@"; do [ "$prev" = "--message-file" ] && cp "$a" "${keep}"; prev="$a"; done\necho '{"runId":"r1","status":"ok","result":{"payloads":[{"text":"Noted.","mediaUrl":null}]}}'\n`);
  await chmod(brain, 0o755);
  await promisify(execFile)(process.execPath, [join(SCRIPTSDIR, "orion-remote"), "handle", "--from", "phone", "--mode", "chat", "--", "gym"], { env: { PATH: process.env.PATH, HOME: home, ORION_REMOTE_ALLOW: "phone", ORION_BRAIN_BIN: brain } }).catch(() => {});
  const text = await readFile(keep, "utf8");
  assert.match(text, /\(blank ask about 14:00-now\)/);
  assert.doesNotMatch(text, /840/);
});
const SCRIPTSDIR = join(import.meta.dirname, "../scripts");

// ---- 10: the morning anchor fill bumps lower ranks and tells him; with no room it is told once and not retried --------------------------------------------
test("10: when there is no room for the gym, orion-proactive does not ask, does not retry, and leaves the one message to orion-reschedule", () => {
  const W = join(import.meta.dirname, "..");
  const home = mkdtempSync(join(tmpdir(), "orion-anchor-ask-"));
  const dir = join(home, "controlled"); mkdirSync(dir, { recursive: true });
  const iso = (hh, mi) => new Date(2026, 9, 16, hh, mi).toISOString();
  writeFileSync(join(home, "cal.json"), "[]");
  writeFileSync(join(home, "config.json"), JSON.stringify({ bedtime: "23:45", usualWake: "07:45" }));
  writeFileSync(join(dir, "morning-sent.json"), JSON.stringify({ "2026-10-16": { at: iso(7, 0), signal: "up" } }));
  writeFileSync(join(dir, "awareness.json"), JSON.stringify(awFixture(new Date(2026, 9, 16, 9, 0), {})));
  const fakeResched = join(home, "fake-reschedule.mjs");   // knows --anchors
  writeFileSync(fakeResched, `// supports --anchors\nimport { appendFileSync } from "node:fs";\nappendFileSync("${home}/resched.log", process.argv.slice(2).join(" ") + "\\n");\nconsole.log("NOTHING WAS CHANGED: Gym does not fit on Friday even with every lower-ranked block moved or removed.");\nconsole.log("  NO ROOM: No room for Gym today: it needs 90 min and no open time is left.");\nprocess.exit(1);\n`);
  const fakeReach = join(home, "fake-reach"); writeFileSync(fakeReach, `#!/bin/sh\necho "$@" >> "${home}/reach.log"\necho "Sent - fake"\n`); chmodSync(fakeReach, 0o755);
  const env = { PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(home, "config.json"), ORION_REACH_NOW: iso(9, 0), ORION_REACH_FACTS: JSON.stringify({ idleSeconds: 5, locked: false }),
    ORION_BRIDGE_BIN: join(W, "tests/fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"), ORION_SESSION_SOCKET: join(home, "no.sock"), ORION_RESCHEDULE_BIN: fakeResched, ORION_REACH_BIN: fakeReach };
  const tick = () => spawnSync(process.execPath, [join(W, "scripts/orion-proactive"), "tick"], { encoding: "utf8", env, timeout: 120000 });
  assert.equal(tick().status, 0);
  tick();
  const calls = readFileSync(join(home, "resched.log"), "utf8").trim().split("\n");
  assert.equal(calls.length, 1, "the fill is not retried on the next tick");
  assert.match(calls[0], /fill --anchors --auto/, "it asks for the automatic fill, which sends the one message itself");
  const reached = existsSync(join(home, "reach.log")) ? readFileSync(join(home, "reach.log"), "utf8") : "";
  assert.doesNotMatch(reached, /gym/i, "proactive itself asks nothing about the gym");
});
