// Scenarios 1, 3, 16, 17 and exit codes 0/3/4 for orion-reach, with a literal awareness.json and fake bins.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mergeHeld } from "../scripts/lib/reach/held.mjs";
import { harness, NOW } from "./delivery-helpers.mjs";

const focus = { session: { state: "focus", at: NOW.toISOString() } };
const rest = { session: { state: "rest", at: NOW.toISOString() } };

test("scenario 1: held during focus, one row on the break, nothing on a second release", () => {
  const h = harness(); h.setAwareness(focus);
  const held = h.run("orion-reach", ["Rain at 3", "--kind", "info"]);
  assert.match(held.stdout, /^Held/, held.stderr);
  assert.equal(h.read("outreach-outbox.jsonl").length, 0);
  assert.equal(h.read("held.jsonl")[0].heldFor, "focus");
  h.setAwareness(rest);
  const drain = h.run("orion-reach", ["--drain-held", "--reason", "break"]);
  assert.match(drain.stdout, /^Sent/, drain.stdout + drain.stderr);
  assert.deepEqual(h.read("outreach-outbox.jsonl").map((r) => r.text), ["Rain at 3"]);
  assert.match(h.run("orion-reach", ["--drain-held", "--reason", "break"]).stdout, /Nothing held/);
  assert.equal(h.read("outreach-outbox.jsonl").length, 1);
});

test("scenario 1: two held items go out as one merged 'While you were focused' message, and a drain in focus leaves them", () => {
  const h = harness(); h.setAwareness(focus);
  h.run("orion-reach", ["Rain at 3."]); h.run("orion-reach", ["Gym at 5."]);
  assert.match(h.run("orion-reach", ["--drain-held", "--reason", "break"]).stdout, /^Still held/);
  assert.equal(h.read("held.jsonl").length, 2);
  h.setAwareness(rest);
  h.run("orion-reach", ["--drain-held", "--reason", "break"]);
  assert.deepEqual(h.read("outreach-outbox.jsonl").map((r) => r.text), ["While you were focused: Rain at 3. Gym at 5."]);
});

test("a paused session releases only after 3 minutes", () => {
  const h = harness();
  h.setAwareness(focus); h.run("orion-reach", ["Rain at 3"]);
  const since = (s) => new Date(NOW.getTime() - s * 1000).toISOString();
  h.setAwareness({ session: { state: "paused", since: since(60), at: NOW.toISOString() } });
  assert.match(h.run("orion-reach", ["--drain-held", "--reason", "break"]).stdout, /Still held/);
  h.setAwareness({ session: { state: "paused", since: since(200), at: NOW.toISOString() } });
  assert.match(h.run("orion-reach", ["--drain-held", "--reason", "break"]).stdout, /^Sent/);
});

test("class: held until the class ends; sleep: held as quiet", () => {
  const h = harness();
  h.setAwareness({ calendar: { state: "ok", now: { kind: "class", title: "CS1800" }, at: NOW.toISOString() } });
  assert.match(h.run("orion-reach", ["Rain at 3"]).stdout, /^Held/);
  assert.equal(h.read("held.jsonl")[0].heldFor, "class");
  h.setAwareness({ sleep: { state: "asleep", at: NOW.toISOString() } });
  h.run("orion-reach", ["Gym at 5"]);
  assert.equal(h.read("held.jsonl")[1].heldFor, "quiet");
});

test("scenario 3: a class nudge and a reminder he set go out at once during focus", () => {
  const h = harness(); h.setAwareness(focus);
  assert.match(h.run("orion-reach", ["Leave in 10 min for CS1800.", "--kind", "reminder", "--urgent-kind", "class"]).stdout, /^Sent/);
  assert.match(h.run("orion-reach", ["Call mom.", "--kind", "reminder", "--urgent"]).stdout, /^Sent/);
  assert.equal(h.read("outreach-outbox.jsonl").length, 2);
});

test("an ask that gets held is dropped, never queued; the ask is stored on the row and the outbox row", () => {
  const h = harness(); h.setAwareness(focus);
  const ask = JSON.stringify({ type: "mismatch", blockId: "b1" });
  h.run("orion-reach", ["Time to start: resume.", "--kind", "question", "--ask", ask]);
  assert.equal(h.read("held.jsonl").length, 0);
  h.setAwareness(rest);
  h.run("orion-reach", ["Time to start: resume.", "--kind", "question", "--ask", ask, "--valid-until", "2026-10-16T15:00:00Z"]);
  const row = h.read("outreach-outbox.jsonl")[0];
  assert.equal(row.ask.blockId, "b1"); assert.equal(row.category, "mismatch"); assert.ok(row.askId); assert.equal(row.validUntil, "2026-10-16T15:00:00Z");
  assert.notEqual(h.run("orion-reach", ["x", "--ask", "nope"]).status, 0);
});

test("held merge wording: templates, 3 lines then +N, stale and asks left out", () => {
  const now = NOW.getTime();
  const e = (text, extra = {}) => ({ id: text, at: new Date(now - 600_000).toISOString(), text, heldFor: "focus", ...extra });
  assert.equal(mergeHeld([e("Rain at 3.")], { now }).text, "Rain at 3.");
  assert.equal(mergeHeld([e("A."), e("B."), e("C."), e("D."), e("E.")], { now }).text, "While you were focused: A. B. C. +2 more in chat.");
  assert.equal(mergeHeld([e("A."), e("B.", { heldFor: "quiet" })], { now }).text, "While you were out of reach: A. B.");
  assert.equal(mergeHeld([e("A.", { heldFor: "quiet" }), e("B.", { heldFor: "quiet" })], { now }).text, "While you were asleep: A. B.");
  assert.equal(mergeHeld([e("A.", { heldFor: "class" }), e("B.", { heldFor: "class" })], { now }).text, "While you were in class: A. B.");
  const out = mergeHeld([e("Leave now.", { validUntil: new Date(now - 1000).toISOString() }), e("What are you up to?", { kind: "question", ask: { type: "blank" } })], { now });
  assert.equal(out.text, null); assert.equal(out.stale.length, 2);
});

const reached = (h, n) => { for (let i = 0; i < n; i++) appendFileSync(join(h.dir, "outreach.jsonl"), `${JSON.stringify({ id: `r${i}`, at: new Date(2026, 9, 16, 0, 5 + i * 40).toISOString(), text: `nudge ${i}`, channel: "phone", why: "plan: b0" })}\n`); };

test("scenario 16: at the ceiling a mismatch nudge exits 3 as dropped, a reminder and a class rung still go", () => {
  const h = harness(); h.setAwareness({});
  reached(h, 20);
  const nudge = h.run("orion-reach", ["Time to start: resume.", "--kind", "checkin", "--why", "plan: b1"]);
  assert.equal(nudge.status, 3); assert.match(nudge.stdout, /ceiling/);
  assert.equal(h.read("outreach.jsonl").at(-1).reason, "ceiling");
  assert.equal(h.read("held.jsonl").length, 0, "dropped, not held");
  assert.equal(h.run("orion-reach", ["Call mom.", "--kind", "reminder", "--urgent", "--why", "proactive:call"]).status, 0);
  assert.equal(h.run("orion-reach", ["Leave now for CS1800.", "--kind", "reminder", "--urgent-kind", "class", "--why", "proactive:leave-late"]).status, 0);
  writeFileSync(join(h.home, "config.json"), JSON.stringify({ bedtime: "23:59", usualWake: "00:01", dailyReachCeiling: 25 }));
  assert.equal(h.run("orion-reach", ["Time to start: resume.", "--kind", "checkin", "--why", "plan: b1"]).status, 0, "the ceiling is configurable");
});

test("under the ceiling a nudge goes; held and failed rows never count", () => {
  const h = harness(); h.setAwareness({});
  reached(h, 19);
  appendFileSync(join(h.dir, "outreach.jsonl"), `${JSON.stringify({ id: "x", at: NOW.toISOString(), text: "held", channel: "hold", why: "plan: b0" })}\n`);
  assert.equal(h.run("orion-reach", ["Time to start: resume.", "--kind", "checkin", "--why", "plan: b1"]).status, 0);
});

const lastRow = (h) => h.read("outreach.jsonl").at(-1);
const facts = (f) => ({ ORION_REACH_FACTS: JSON.stringify({ locked: false, headphones: false, ...f }) });

test("scenario 17: voice only at home or with headphones; the bubble otherwise", () => {
  const h = harness();
  const say = (text, aw, f) => { h.setAwareness(aw); h.run("orion-reach", [text], facts(f)); return lastRow(h); };
  const here = (state, placeId = null) => ({ location: { state, placeId, source: "region", at: NOW.toISOString() } });
  assert.equal(say("one", here("home", "home"), { idleSeconds: 5 }).channel, "mac-voice");
  assert.equal(say("two", { audio: { mac: { headphones: true, at: NOW.toISOString() }, phone: { headphones: null, at: NOW.toISOString() } } }, { idleSeconds: 5 }).channel, "mac-voice");
  assert.equal(say("three", {}, { idleSeconds: 5 }).channel, "mac-bubble");
  assert.equal(say("four", { audio: { mac: { headphones: false, at: NOW.toISOString() }, phone: { headphones: true, at: NOW.toISOString() } } }, { idleSeconds: 5 }).channel, "mac-bubble");
});

test("scenario 17: idle 6 min goes to the phone plus a silent Mac bubble; timeSensitive only with phone headphones", () => {
  const h = harness();
  const phoneAudio = (headphones) => ({ audio: { mac: { headphones: false, at: NOW.toISOString() }, phone: { route: "bluetooth", headphones, at: NOW.toISOString() } } });
  h.setAwareness(phoneAudio(false));
  h.run("orion-reach", ["one"], facts({ idleSeconds: 360 }));
  h.setAwareness(phoneAudio(true));
  h.run("orion-reach", ["two"], facts({ idleSeconds: 360 }));
  const rows = h.read("outreach-outbox.jsonl");
  assert.deepEqual(rows.map((r) => [r.push, r.timeSensitive]), [[true, false], [true, true]]);
  assert.equal(h.read("outreach.jsonl")[0].channel, "phone", "the app shows a non-mac-voice row without speaking");
  assert.equal(h.lines("open.log").length, 2, "each phone row is also posted on the Mac");
});

test("exit codes: 4 when delivery fails, 3 when rate-capped, 0 when sent", () => {
  const h = harness(); h.setAwareness({});
  assert.equal(h.run("orion-reach", ["a"], facts({ idleSeconds: 9999 })).status, 0);
  for (let i = 0; i < 6; i++) appendFileSync(join(h.dir, "outreach.jsonl"), `${JSON.stringify({ id: `f${i}`, at: new Date(NOW.getTime() - 60_000).toISOString(), text: `m${i}`, channel: "phone" })}\n`);
  assert.equal(h.run("orion-reach", ["new one"]).status, 3);
  const h2 = harness(); h2.setAwareness({});
  mkdirSync(join(h2.dir, "outreach-outbox.jsonl"));   // the outbox cannot be written
  assert.equal(h2.run("orion-reach", ["b"]).status, 4);
});
