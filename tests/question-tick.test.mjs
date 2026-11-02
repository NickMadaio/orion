// orion-proactive asks one of ORION's own questions (wave 12 L1): through orion-reach (so it lands in his chat thread),
// marked asked in questions.jsonl, once a day, and never over another ask. Temp HOME and state; nothing real is sent.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { aw } from "./fixtures/curiosity-aw.mjs";

const W = join(import.meta.dirname, "..");
const rows = (f) => (existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

function world() {
  const home = mkdtempSync(join(tmpdir(), "orion-qtick-"));
  const dir = join(home, "controlled"); mkdirSync(dir, { recursive: true });
  const iso = (h, mi) => new Date(2026, 9, 16, h, mi).toISOString();
  writeFileSync(join(home, "cal.json"), JSON.stringify([{ identifier: "gym", title: "Gym", start: iso(17, 0), end: iso(18, 0) }]));
  writeFileSync(join(home, "config.json"), JSON.stringify({ bedtime: "23:45", usualWake: "07:45" }));
  const open = join(home, "fake-open"); writeFileSync(open, "#!/bin/sh\nexit 0\n"); chmodSync(open, 0o755);
  writeFileSync(join(dir, "morning-sent.json"), JSON.stringify({ "2026-10-16": { at: iso(7, 0), signal: "up" } }));
  const env = (h, mi) => ({ PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_LIFE_CONFIG: join(home, "config.json"), ORION_CHECKIN_FILE: join(home, "checkins.json"),
    ORION_REACH_NOW: new Date(2026, 9, 16, h, mi).toISOString(), ORION_NOW: new Date(2026, 9, 16, h, mi).toISOString(), ORION_REACH_FACTS: JSON.stringify({ idleSeconds: 5, locked: false }), ORION_REACH_OPEN_BIN: open,
    ORION_BRIDGE_BIN: join(W, "tests/fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json"), ORION_SESSION_SOCKET: join(home, "no.sock") });
  const tick = (h, mi, over) => {
    writeFileSync(join(dir, "awareness.json"), JSON.stringify(aw(new Date(2026, 9, 16, h, mi), over)));
    return spawnSync(process.execPath, [join(W, "scripts/orion-proactive"), "tick"], { encoding: "utf8", env: env(h, mi), timeout: 120000 });
  };
  const add = (q, h = 9) => spawnSync(process.execPath, [join(W, "scripts/orion-questions"), "add", q, "--topic", "person"], { encoding: "utf8", env: env(h, 0) });
  return { dir, tick, add, log: () => rows(join(dir, "outreach.jsonl")), questions: () => rows(join(dir, "questions.jsonl")) };
}
// Where he is is unknown, so no blank ask ("what are you up to?") competes; he is at the Mac and free.
const AT_MAC = { location: { state: "unknown", placeId: null, homeKnown: true } };

test("at the Mac and free: one question goes out through orion-reach and is marked asked; never twice a day", () => {
  const w = world();
  assert.equal(w.add("Who is Sam?").status, 0);
  const t = w.tick(14, 0, AT_MAC);
  assert.equal(t.status, 0, t.stderr);
  const sent = w.log().filter((r) => /^curiosity: question-/.test(r.why ?? ""));
  assert.equal(sent.length, 1, t.stdout);
  assert.equal(sent[0].text, "Question for you: Who is Sam?");
  assert.equal(sent[0].kind, "question");
  assert.equal(sent[0].ask?.type, "question-note");
  const [q] = w.questions();
  assert.equal(q.status, "asked");
  assert.equal(q.askedText, "Question for you: Who is Sam?");
  w.add("Does he prefer gym mornings?", 14);
  w.tick(15, 30, AT_MAC);
  assert.equal(w.log().filter((r) => /^curiosity: question-/.test(r.why ?? "")).length, 1);
});

test("away from the Mac or in a focus session: nothing is asked", () => {
  const w = world();
  w.add("Who is Sam?");
  w.tick(14, 0, { ...AT_MAC, mac: { state: "idle", idleSeconds: 900 } });
  w.tick(14, 10, { ...AT_MAC, session: { state: "focus" } });
  assert.equal(w.log().filter((r) => /^curiosity: question-/.test(r.why ?? "")).length, 0);
  assert.equal(w.questions()[0].status, "open");
});
