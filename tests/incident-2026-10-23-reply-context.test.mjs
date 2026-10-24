// 2026-10-23: "orion texts me proactively, great! but if i respond he doesnt have context of him talking to me proactively".
// Real rows (outreach.jsonl) and replies (Mac chats, phone thread); personal text cut down to what the rule reads.
process.env.TZ = "Europe/London";
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, appendFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { deliveredRows, pickOutreach, outreachKind, assistantTurn, injectArgs, outreachLabel } from "../scripts/lib/reach/reply-context.mjs";
import { harness } from "./delivery-helpers.mjs";

const GYM_30 = { id: "reach-1792525510031-f19163", at: "2026-10-20T19:45:10.031Z", text: "It's been 30 min. Gym, now. Phone down.", kind: "checkin", why: "plan: cal-4-897c", tier: "protected", channel: "mac-voice",
  ask: { type: "mismatch", title: "Gym", window: { date: "2026-10-20", start: 1215, end: 1305 }, level: 3, kind: "mismatch" }, askId: "reach-1792525510031-f19163" };
const BED_NOW = { id: "reach-1792450976763-60ce0e", at: "2026-10-19T23:02:56.763Z", text: "It's 12:02 AM, bedtime. Sleep now and you get 8h 58m before your alarm.", kind: "reminder", why: "proactive: bed-now", channel: "mac-bubble" };
const PAST_BED = { id: "reach-1792115063291-61a82a", at: "2026-10-16T01:44:23.291Z", text: "Session done. It's 2:44 AM — past bedtime; sleep now and you get 6h 16m.", kind: "reminder", why: "proactive: session-done-x", channel: "mac-voice" };
const HELD = { id: "reach-h", at: "2026-10-20T19:44:00Z", text: "held one", channel: "hold" };
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n");

test("delivered rows: held and dropped rows never count as what he answers", () => {
  const rows = deliveredRows(jsonl([GYM_30, HELD, { ...BED_NOW, id: "d", status: "dropped", channel: "hold" }]));
  assert.deepEqual(rows.map((r) => r.id), [GYM_30.id]);
});

test("10-20 19:45:20 'I'm meal prepping. That's why. Sorry.' answers the Gym rung sent 10 s earlier", () => {
  const row = pickOutreach(deliveredRows(jsonl([GYM_30])), { now: Date.parse("2026-10-20T19:45:20Z") });
  assert.equal(row?.id, GYM_30.id);
  assert.equal(outreachKind(row), "start");
});

test("10-19 23:03:03 'im doing work shush up' answers the 12:02 bedtime line; 10-16 01:45 phone reply answers 'past bedtime'", () => {
  assert.equal(outreachKind(pickOutreach([BED_NOW], { now: Date.parse("2026-10-19T23:03:03Z") })), "bedtime");
  assert.equal(outreachKind(pickOutreach([PAST_BED], { now: Date.parse("2026-10-16T01:45:18Z") })), "bedtime");
});

test("a reply after he already said something since, or past the window, is not linked; a tapped id is, even late", () => {
  const now = Date.parse("2026-10-20T19:45:20Z");
  assert.equal(pickOutreach([GYM_30], { now, turns: [Date.parse("2026-10-20T19:45:15Z")] }), null);
  assert.equal(pickOutreach([BED_NOW], { now: Date.parse("2026-10-19T23:40:00Z") }), null);   // plain line, 37 min: no
  assert.equal(pickOutreach([GYM_30], { now: Date.parse("2026-10-20T21:00:00Z") })?.id, GYM_30.id);   // an ask, 75 min: still his answer
  assert.equal(pickOutreach([GYM_30], { now: Date.parse("2026-10-20T21:20:00Z") }), null);           // 95 min: no
  assert.equal(pickOutreach([GYM_30], { now: Date.parse("2026-10-20T22:00:00Z"), replyTo: `${GYM_30.id}-orion` })?.id, GYM_30.id);   // the phone thread's id
});

test("ORION's injected turn is his words plus when and that ORION started it; the label names the kind", () => {
  assert.match(assistantTurn(BED_NOW), /^It's 12:02 AM, bedtime\./);
  assert.match(assistantTurn(BED_NOW), /sent by ORION at 00:02, ORION started this conversation/);
  const args = injectArgs({ sessionKey: "orion-chat-33e1581c", row: GYM_30 });
  assert.deepEqual(args.slice(0, 3), ["gateway", "call", "chat.inject"]);
  const params = JSON.parse(args.at(-1));
  assert.equal(params.sessionKey, "orion-chat-33e1581c");
  assert.equal(params.label, "orion-outreach");
  assert.match(outreachLabel(GYM_30, Date.parse("2026-10-20T19:45:20Z")), /^\[ORION context: you messaged him first, 0 min ago \(start\): "It's been 30 min\. Gym, now/);
});

function withFakeGateway(now) {
  const h = harness({ now: new Date(now), facts: { idleSeconds: 10, locked: false } });
  const bin = join(h.home, "fake-openclaw");
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${h.home}/openclaw.log"\necho '{"ok":true}'\n`); chmodSync(bin, 0o755);
  return { h, env: { ORION_OPENCLAW_BIN: bin } };
}

test("orion-inbound-turn --session: the Gym rung goes into the reply's session as ORION's turn, once", () => {
  const { h, env } = withFakeGateway("2026-10-20T19:45:20Z");
  appendFileSync(join(h.dir, "outreach.jsonl"), `${JSON.stringify(GYM_30)}\n`);
  const r = h.run("orion-inbound-turn", ["--session", "orion-chat-9311fb49", "--text", "I'm meal prepping. That's why. Sorry."], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /injected reach-1792525510031-f19163/);
  const calls = h.lines("openclaw.log");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /gateway call chat\.inject/);
  assert.match(calls[0], /"sessionKey":"orion-chat-9311fb49"/);
  assert.match(calls[0], /It's been 30 min\. Gym, now\. Phone down\./);
  // a second message in the same minute: already in the session, and he has spoken since
  h.run("orion-inbound-turn", ["--session", "orion-chat-9311fb49", "--text", "like 20 min"], env);
  assert.equal(h.lines("openclaw.log").length, 1);
  assert.ok(!existsSync(join(h.dir, "bedtime-ack.json")));   // a Gym rung is not a bedtime line
});

test("orion-inbound-turn with no outreach to answer, or no --session: no inject", () => {
  const { h, env } = withFakeGateway("2026-10-20T19:45:20Z");
  h.run("orion-inbound-turn", ["--session", "orion-chat-x", "--text", "whats the weather"], env);
  appendFileSync(join(h.dir, "outreach.jsonl"), `${JSON.stringify(GYM_30)}\n`);
  h.run("orion-inbound-turn", ["--text", "whats the weather"], env);
  assert.equal(h.lines("openclaw.log").length, 0);
  assert.ok(readFileSync(join(h.dir, "inbound-turns.jsonl"), "utf8").trim().split("\n").length === 2);
});
