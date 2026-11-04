// What reaches Nick's chat is a sentence for a person: no job tags, no "Orion | LABEL |" headers, 12-hour clock.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { chatText, to12Hour } from "../scripts/lib/reach/chat-text.mjs";
import { logOutreach } from "../scripts/lib/reach/log-outreach.mjs";

const REACH = join(import.meta.dirname, "../scripts/orion-reach");

test("an internal job's output never reaches the chat", () => {
  assert.equal(chatText("[daily-memory] 2026-11-03: 4 requests -> memory/2026-11-03.md\n  archived 4 rows -> archive/x.gz"), null);
  assert.equal(chatText("  [nightly-index] rebuilt 12 shards"), null);
});

test("a milestone shows only its sentence", () => {
  const raw = "Orion | MILESTONE REACHED | standing-check\nHeads up 9:00 AM — CS1802 Discrete Structures — Seminar @ Portsoken 802. Starts in 1h 57m.\nNo action needed.";
  assert.equal(chatText(raw), "Heads up 9:00 AM — CS1802 Discrete Structures — Seminar @ Portsoken 802. Starts in 1h 57m.");
});

test("a blocked event keeps what it waits on but loses the header", () => {
  const raw = "Orion | BLOCKED - INPUT REQUIRED | build-x\nNeed a key.\nWaiting on: the key\nReply \"approve ap-1234\" or \"deny ap-1234\".";
  const out = chatText(raw);
  assert.ok(out.startsWith("Need a key."));
  assert.match(out, /approve ap-1234/);
  assert.doesNotMatch(out, /Orion \|/);
});

test("a held digest becomes its sentences, one per line", () => {
  const raw = "Orion | HELD UPDATES | 2 update(s)\n- [MILESTONE REACHED] standing-check: Heads up 3:30 PM — MKTG2201 — Lecture.\n- [MILESTONE REACHED] standing-evening: Evening · Tue, Nov 3 Today is done.";
  assert.equal(chatText(raw), "Heads up 3:30 PM — MKTG2201 — Lecture.\nEvening · Tue, Nov 3 Today is done.");
});

test("the retry digest unwraps too", () => {
  const raw = "Orion | 2 UPDATES THAT DID NOT GO OUT\n- m1: Heads up 9:00 AM — Seminar.\n- m2: Leave in 10 min.";
  assert.equal(chatText(raw), "Heads up 9:00 AM — Seminar.\nLeave in 10 min.");
});

test("24-hour clock times become 12-hour, 12-hour ones are left alone", () => {
  assert.equal(to12Hour("It's 22:18. Phone down."), "It's 10:18 PM. Phone down.");
  assert.equal(to12Hour("Bed at 00:00."), "Bed at 12:00 AM.");
  assert.equal(to12Hour("Fitted Gym 21:20–22:50. Moved: Learning plan to 22:55."), "Fitted Gym 9:20 PM–10:50 PM. Moved: Learning plan to 10:55 PM.");
  assert.equal(to12Hour("CS2100 at 09:00 tomorrow"), "CS2100 at 9:00 AM tomorrow");
  assert.equal(to12Hour("It's 10:08 PM and 5:50 AM"), "It's 10:08 PM and 5:50 AM");
  assert.equal(to12Hour("what was 12:30 to 3:30?"), "what was 12:30 to 3:30?");
  assert.equal(to12Hour("1:30:00 and 7h 59m left"), "1:30:00 and 7h 59m left");
});

test("an ordinary sentence passes through untouched", () => {
  assert.equal(chatText("Where are you at? I'll log it."), "Where are you at? I'll log it.");
});

test("logOutreach stores the clean sentence and refuses internal output", () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-text-"));
  const raw = "Orion | MILESTONE REACHED | standing-morning\nMorning · Wed, Nov 4 Today: 5 commitment(s).\nNo action needed.";
  const done = logOutreach(dir, { text: raw, kind: "update", channel: "discord", id: "m-1" });
  assert.equal(done.ok, true);
  assert.equal(JSON.parse(readFileSync(join(dir, "outreach.jsonl"), "utf8").trim()).text, "Morning · Wed, Nov 4 Today: 5 commitment(s).");
  assert.equal(JSON.parse(readFileSync(join(dir, "outreach-outbox.jsonl"), "utf8").trim()).text, "Morning · Wed, Nov 4 Today: 5 commitment(s).");
  const internal = logOutreach(dir, { text: "[daily-memory] 2026-11-03: 4 requests", kind: "update", channel: "discord", id: "m-2" });
  assert.equal(internal.ok, false);
  assert.match(internal.reason, /internal/);
});

test("logOutreach keeps the time a phone notification really fired", () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-text-"));
  const fired = new Date("2026-11-03T22:18:00Z");
  logOutreach(dir, { text: "It's 22:18. Phone down.", kind: "update", channel: "phone", id: "phone.orion.night.1", now: new Date("2026-11-03T22:44:03Z"), at: fired });
  const row = JSON.parse(readFileSync(join(dir, "outreach.jsonl"), "utf8").trim());
  assert.equal(row.at, fired.toISOString());
  assert.equal(row.text, "It's 10:18 PM. Phone down.");
});

test("orion-reach --already-sent applies the same rules and honours --at", () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-text-"));
  const env = { PATH: process.env.PATH, HOME: dir, ORION_CONTROLLED_DIR: dir };
  const run = (...args) => spawnSync(process.execPath, [REACH, ...args], { env, encoding: "utf8" });
  const internal = run("[daily-memory] 2026-11-03: 4 requests", "--already-sent", "discord", "--id", "r-1");
  assert.notEqual(internal.status, 0);
  const ok = run("Bed at 23:30.", "--already-sent", "phone", "--id", "phone.x.1", "--at", "2026-11-03T22:18:00Z");
  assert.equal(ok.status, 0, ok.stderr);
  const row = JSON.parse(readFileSync(join(dir, "outreach.jsonl"), "utf8").trim().split("\n").at(-1));
  assert.equal(row.at, "2026-11-03T22:18:00.000Z");
  assert.equal(row.text, "Bed at 11:30 PM.");
});

test("orion-reach on the main path drops job output and cleans a notify header and times", () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-text-"));
  const env = { PATH: process.env.PATH, HOME: dir, ORION_CONTROLLED_DIR: dir, ORION_REACH_NOW: "2026-11-03T14:00:00Z", ORION_REACH_FACTS: JSON.stringify({ idleSeconds: 5, locked: false, headphones: false }), ORION_REACH_OPEN_BIN: "/usr/bin/true", ORION_AWARENESS_NO_REFRESH: "1" };
  const run = (...args) => spawnSync(process.execPath, [REACH, ...args], { env, encoding: "utf8" });
  const internal = run("[daily-memory] 2026-11-03: 4 requests -> /x/y.md");
  assert.equal(internal.status, 3);
  assert.match(internal.stdout, /^NOT SENT: dropped/);
  const shown = run("Orion | MILESTONE REACHED | standing-check\nHeads up 9:00 AM — Seminar. It's 22:18.\nNo action needed.", "--channel", "phone", "--json");
  assert.equal(shown.status, 0, shown.stdout + shown.stderr);
  const box = JSON.parse(readFileSync(join(dir, "outreach-outbox.jsonl"), "utf8").trim().split("\n").at(-1));
  assert.equal(box.text, "Heads up 9:00 AM — Seminar. It's 10:18 PM.");
});
