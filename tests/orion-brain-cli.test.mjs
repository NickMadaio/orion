// orion-brain over Basic Memory's renamed tool commands (gate run-1031133008, cluster 5).
// Basic Memory renamed search-notes -> search, read-note -> read, write-note -> write, edit-note -> edit. Every orion-brain call failed
// with "No such command 'search-notes'" and the host appended "Exec failed: orion-brain search …" to Nick's replies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BRAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-brain");

/** A fake basic-memory that records its argv. `legacyOnly` rejects the new command names, like an old install. */
function fakeBasicMemory({ legacyOnly = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "orion-brain-"));
  const log = join(dir, "calls.jsonl");
  const bin = join(dir, "basic-memory");
  const NEW = ["search", "read", "write", "edit", "context", "project"];
  const OLD = ["search-notes", "read-note", "write-note", "edit-note", "build-context", "recent-activity"];
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const cmd = args[1];
const known = ${JSON.stringify(legacyOnly ? OLD : NEW)};
if (!known.includes(cmd)) { process.stderr.write("No such command '" + cmd + "'. Did you mean 'search'?\\n"); process.exit(2); }
if (cmd === "search" || cmd === "search-notes") { console.log(JSON.stringify({ results: [{ title: "Nick", permalink: "20-areas-me/nick", content: "- [fact] takes creatine at 8" }] })); process.exit(0); }
if (cmd === "read" || cmd === "read-note") { if (/Missing/.test(args[2])) { process.stderr.write("Error: NOT_FOUND\\n"); process.exit(1); } console.log("# Nick\\n## Learned\\n- [fact] x"); process.exit(0); }
console.log("ok");
`);
  chmodSync(bin, 0o755);
  const calls = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { bin, calls };
}
const run = (bin, args) => spawnSync(process.execPath, [BRAIN, ...args], { encoding: "utf8", env: { ...process.env, ORION_BASIC_MEMORY: bin } });

test("search uses the current `search --json` command and prints the matches", () => {
  const bm = fakeBasicMemory();
  const out = run(bm.bin, ["search", "Nick"]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /## Nick {2}\(20-areas-me\/nick\)/);
  assert.match(out.stdout, /creatine/);
  assert.deepEqual(bm.calls()[0], ["tool", "search", "Nick", "--json", "--project", "orion"]);
});

test("an older Basic Memory (search-notes) still works", () => {
  const bm = fakeBasicMemory({ legacyOnly: true });
  const out = run(bm.bin, ["search", "routine"]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /## Nick/);
  assert.deepEqual(bm.calls().map((c) => c[1]), ["search", "search-notes"]);
});

test("learn appends to an existing note with `edit --command append`", () => {
  const bm = fakeBasicMemory();
  const out = run(bm.bin, ["learn", "Nick", "preference", "hates being called buddy, no emojis"]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Added to "Nick"/);
  const edits = bm.calls().filter((c) => c[1] === "edit");
  assert.ok(edits.length >= 1);
  assert.deepEqual(edits.at(-1).slice(0, 5), ["tool", "edit", "Nick", "--command", "append"]);
});

test("learn creates a missing note with `write --title … --directory`", () => {
  const bm = fakeBasicMemory();
  const out = run(bm.bin, ["learn", "Missing Note", "fact", "something new"]);
  assert.equal(out.status, 0, out.stderr);
  const write = bm.calls().find((c) => c[1] === "write");
  assert.ok(write, JSON.stringify(bm.calls()));
  assert.ok(write.includes("--directory") && write.includes("20 Areas/Learned"));
});

void execFileSync;
