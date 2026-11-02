import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupNotes, computerSteps, notesEffect } from "../lib/computer-evidence.mjs";

const fakeNotes = (created) => {
  const live = new Map(created);
  const asked = [];
  return { createdSince: async (sec) => { asked.push(sec); return [...live].map(([id, name]) => ({ id, name })); }, remove: async (id) => live.delete(id), has: (id) => live.has(id), asked };
};

test("computer steps since the turn started become tool calls, errors flagged", () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-steps-"));
  const p = { shadow: join(dir, "shadow.jsonl") };
  const line = (at, sessionKey, steps) => JSON.stringify({ at, sessionKey, steps });
  writeFileSync(`${p.shadow}.steps`, [
    line("2026-11-02T01:00:00Z", "orion-chat-a", [{ canonical: "computer open Notes", stdout: "Changed open Notes (confirmed on screen)", exit: 0 }]),
    line("2026-11-02T02:00:00Z", "orion-chat-b", [{ canonical: "computer open Notes", stdout: "Changed open Notes (confirmed on screen)", exit: 0 }, { canonical: "computer menu File", stdout: "Error: x", exit: 1 }]),
    "not json",
  ].join("\n"));
  const calls = computerSteps(p, Date.parse("2026-11-02T01:30:00Z"), "orion-chat-b");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].tool, "computer");
  assert.match(calls[0].result, /confirmed/);
  assert.equal(calls[1].isError, true);
  assert.deepEqual(computerSteps(p, Date.parse("2026-11-02T01:30:00Z"), "orion-chat-zzz"), []);
  assert.deepEqual(computerSteps({ shadow: join(dir, "none") }, 0), []);
});

test("only notes created since the start are asked for, reported, then deleted", async () => {
  const notes = fakeNotes([["n2", "econ ideas"]]);
  const found = await notesEffect(Date.now() - 10_000, notes);
  assert.equal(notes.asked.length, 1);
  assert.ok(notes.asked[0] >= 11 && notes.asked[0] < 20, "window is the elapsed time plus slack, not the library");
  assert.deepEqual(found, { probed: true, created: [{ id: "n2", name: "econ ideas" }], deleted: [] });
  const done = await cleanupNotes(found, notes);
  assert.deepEqual(done.deleted, ["n2"]);
  assert.equal(notes.has("n2"), false);
});

test("slow or unreadable Notes is not probed and nothing is deleted or blocked on", async () => {
  const slow = { createdSince: async () => null, remove: async () => { throw new Error("no"); } };
  const eff = await notesEffect(Date.now(), slow);
  assert.equal(eff.probed, false);
  assert.deepEqual((await cleanupNotes(eff, slow)).deleted, []);
  assert.equal((await notesEffect(NaN, slow)).probed, false);
  const throwing = { createdSince: async () => { throw new Error("x"); } };
  assert.equal((await notesEffect(Date.now(), throwing)).probed, false);
});

test("a runaway number of created notes deletes at most five", async () => {
  const notes = fakeNotes(Array.from({ length: 9 }, (_, i) => [`n${i}`, "x"]));
  const found = await notesEffect(Date.now() - 1000, notes);
  assert.equal((await cleanupNotes(found, notes)).deleted.length, 5);
});
