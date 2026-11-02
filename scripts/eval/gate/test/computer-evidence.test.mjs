import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupNotes, computerSteps, notesBefore, notesEffect } from "../lib/computer-evidence.mjs";

const fakeNotes = (initial) => {
  const ids = new Map(initial);
  return { ids: async () => [...ids.keys()], name: async (id) => ids.get(id), remove: async (id) => ids.delete(id), add: (id, name) => ids.set(id, name), has: (id) => ids.has(id) };
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

test("notes the item created are reported then deleted; older notes are untouched", async () => {
  const notes = fakeNotes([["n1", "Groceries"]]);
  const before = await notesBefore(notes);
  notes.add("n2", "econ ideas");
  const found = await notesEffect(before, notes);
  assert.deepEqual(found.created, [{ id: "n2", name: "econ ideas" }]);
  const done = await cleanupNotes(found, notes);
  assert.deepEqual(done.deleted, ["n2"]);
  assert.equal(notes.has("n2"), false);
  assert.equal(notes.has("n1"), true);
});

test("an unreadable Notes is reported as not probed and nothing is deleted", async () => {
  const dead = { ids: async () => null, name: async () => "", remove: async () => { throw new Error("no"); } };
  assert.equal(await notesBefore(dead), null);
  const eff = await notesEffect(null, dead);
  assert.equal(eff.probed, false);
  assert.deepEqual((await cleanupNotes(eff, dead)).deleted, []);
});
