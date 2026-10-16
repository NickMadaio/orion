// WP3/WP5 glue (2026-10-16): every proactive ask is a chat message he can reply to, and his replies are logged so an
// ignored ask can be told from an answered one. orion-reach --ask -> outbox row (askId, orion.ask) -> his reply
// (replyTo / first message after it) -> orion-inbound-turn -> inbound-turns.jsonl + `orion-proactive ask-outcome`.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { harness, SCRIPTS } from "./delivery-helpers.mjs";
import { readLedger, recordAsk, writeLedger } from "../scripts/lib/curiosity/ledger.mjs";
import { NOTHING_REPLY } from "../scripts/lib/curiosity/inbound.mjs";

const PHONE = { idleSeconds: 9999, locked: true };   // the Mac is away: the ask goes to the phone

function sentAsk() {
  const h = harness({ facts: PHONE });
  h.setAwareness({});
  const ask = JSON.stringify({ type: "blank", askId: "ask-1", window: { date: "2026-10-16", start: "13:00", end: null } });
  const r = h.run("orion-reach", ["What have you been up to since 1? I'll log it.", "--kind", "question", "--why", "curiosity: blank", "--ask", ask, "--json"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const reachId = JSON.parse(r.stdout).id;
  const at = new Date(h.env.ORION_REACH_NOW);
  writeLedger(h.dir, recordAsk(readLedger(h.dir), { askId: "ask-1", reachId, type: "blank", key: "blank-1", at: at.toISOString() }));
  return { h, reachId };
}

const turn = (h, args, atMinutes = 5) => spawnSync(process.execPath, [join(SCRIPTS, "orion-inbound-turn"), ...args], {
  encoding: "utf8", env: { ...h.env, ORION_REACH_NOW: new Date(Date.parse(h.env.ORION_REACH_NOW) + atMinutes * 60_000).toISOString(), ORION_PROACTIVE_BIN: join(SCRIPTS, "orion-proactive") } });
const ask = (h) => readLedger(h.dir).asks[0];
const turns = (h) => h.read("inbound-turns.jsonl");

test("orion-reach --ask writes the outbox row the phone link turns into a thread message: id, askId, orion.ask, timeSensitive", () => {
  const { h, reachId } = sentAsk();
  const row = h.read("outreach-outbox.jsonl")[0];
  assert.equal(row.id, reachId);
  assert.equal(row.kind, "question");
  assert.equal(row.push, true);
  assert.equal(row.askId, "ask-1");
  assert.equal(row.category, "orion.ask");
  assert.equal(typeof row.timeSensitive, "boolean");
  assert.equal(row.ask.window.start, "13:00");
  // The same row, as OutreachThread.entry(from:) reads it: id and text, a question, push, and the text-reply category.
  assert.ok(row.text.length > 0);
});

test("a reply that carries replyTo (the reach id of the message he answered) closes its ask as answered and logs the turn", () => {
  const { h, reachId } = sentAsk();
  assert.equal(turn(h, ["--reply-to", reachId, "--text", "was at the gym"]).status, 0);
  assert.equal(ask(h).outcome, "answered");
  assert.equal(turns(h).length, 1);
  assert.ok(Date.parse(turns(h)[0].at) > 0);
});

test("replyTo may be the askId itself", () => {
  const { h } = sentAsk();
  turn(h, ["--reply-to", "ask-1", "--text", "reading"]);
  assert.equal(ask(h).outcome, "answered");
});

test("with no id, the first message after the ask answers it; the second does not reopen anything", () => {
  const { h } = sentAsk();
  turn(h, ["--text", "studying"], 5);
  assert.equal(ask(h).outcome, "answered");
  assert.equal(turns(h).length, 1);
  turn(h, ["--text", "ok"], 6);
  assert.equal(ask(h).outcome, "answered");
  assert.equal(turns(h).length, 2);
});

test("a message more than 90 minutes after the ask answers nothing, but is still logged", () => {
  const { h } = sentAsk();
  turn(h, ["--text", "hello"], 100);
  assert.equal(ask(h).outcome, null);
  assert.equal(turns(h).length, 1);
});

test("an earlier message after the ask means a later plain one is not its answer", () => {
  const { h } = sentAsk();
  writeFileSync(join(h.dir, "inbound-turns.jsonl"), `${JSON.stringify({ at: new Date(Date.parse(h.env.ORION_REACH_NOW) + 2 * 60_000).toISOString() })}\n`);
  turn(h, ["--text", "something else"], 10);
  assert.equal(ask(h).outcome, null);
});

test("'nothing really' closes the ask as nothing", () => {
  const { h, reachId } = sentAsk();
  turn(h, ["--reply-to", reachId, "--text", "nothing really"]);
  assert.equal(ask(h).outcome, "nothing");
});

test("ask-outcome may make a plain 'answered' more exact, never the other way", () => {
  const { h, reachId } = sentAsk();
  turn(h, ["--reply-to", reachId, "--text", "hi"]);
  const outcome = (o) => spawnSync(process.execPath, [join(SCRIPTS, "orion-proactive"), "ask-outcome", "ask-1", o], { env: h.env, encoding: "utf8" });
  assert.equal(ask(h).outcome, "answered");
  assert.equal(outcome("logged").status, 0);
  assert.equal(ask(h).outcome, "logged");
  outcome("answered");
  assert.equal(ask(h).outcome, "logged");
});

test("the plugin's 'nothing really' pattern and the script's are the same pattern", () => {
  const src = readFileSync(join(import.meta.dirname, "../plugin/orion-control/src/schedule-flow.ts"), "utf8");
  const m = src.match(/export const NOTHING_REPLY = (\/.*\/i);/);
  assert.ok(m, "plugin NOTHING_REPLY found");
  assert.equal(m[1], String(NOTHING_REPLY));
});

test("orion-remote logs the turn (via orion-inbound-turn) with the reply-to the phone sent", () => {
  const home = mkdtempSync(join(tmpdir(), "orion-remote-inbound-"));
  const dir = join(home, ".openclaw/orion-controlled"); mkdirSync(dir, { recursive: true }); mkdirSync(join(home, ".openclaw/workspace"), { recursive: true });
  writeFileSync(join(dir, "outreach.jsonl"), "");
  const record = join(home, "inbound.args");
  const fake = join(home, "fake-inbound"); writeFileSync(fake, `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n`); chmodSync(fake, 0o755);
  const brain = join(home, "fake-openclaw");
  writeFileSync(brain, `#!/bin/bash\necho '{"runId":"r1","status":"ok","result":{"payloads":[{"text":"Noted.","mediaUrl":null}]}}'\n`); chmodSync(brain, 0o755);
  const env = { PATH: process.env.PATH, HOME: home, ORION_REMOTE_ALLOW: "phone", ORION_BRAIN_BIN: brain, ORION_INBOUND_BIN: fake };
  spawnSync(process.execPath, [join(SCRIPTS, "orion-remote"), "handle", "--from", "phone", "--mode", "chat", "--reply-to", "reach-9", "--", "at the gym"], { env, encoding: "utf8" });
  assert.ok(existsSync(record), "orion-inbound-turn was called");
  assert.deepEqual(JSON.parse(readFileSync(record, "utf8").trim().split("\n")[0]), ["--reply-to", "reach-9", "--text", "at the gym"]);
});
