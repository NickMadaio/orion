// REV2 BRAIN (2026-10-31): `orion-brain learn` lost its test in 19d029a. A fake basic-memory under a temp HOME records every call; learn
// creates a missing note and appends to an existing one; a title that could be read as an option or a path is refused before anything
// runs; ranked search asks for full results (no --compact), so excerpts reach the reply.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bmArgs } from "../scripts/lib/brain/bm.mjs";

const BRAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-brain");

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), "orion-brain-learn-"));
  const bin = join(home, ".local", "bin"); mkdirSync(bin, { recursive: true });
  const log = join(home, "calls.jsonl");
  writeFileSync(join(bin, "basic-memory"), `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
if (args[1] === "read") { if (/Missing/.test(args[2])) { process.stderr.write("Error: NOT_FOUND\\n"); process.exit(1); } console.log("# Nick\\n## Learned\\n- [fact] x"); process.exit(0); }
console.log("ok");
`);
  chmodSync(join(bin, "basic-memory"), 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const run = (args) => spawnSync(process.execPath, [BRAIN, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: home } });
  return { run, calls };
}

test("learn appends to an existing note", () => {
  const h = fakeHome();
  const out = h.run(["learn", "Nick", "preference", "hates being called buddy, no emojis"]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^Added to "Nick": - \[preference\] hates being called buddy, no emojis/);
  const edit = h.calls().find((c) => c[1] === "edit");
  assert.deepEqual(edit.slice(0, 5), ["tool", "edit", "Nick", "--command", "append"]);
  assert.match(edit[edit.indexOf("--content") + 1], /\[preference\] hates being called buddy/);
});

test("learn creates a missing note under 20 Areas/Learned, linked to Nick", () => {
  const h = fakeHome();
  const out = h.run(["learn", "Missing Gym Note", "routine", "gym at 5 most days"]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^New note "Missing Gym Note" \(linked to Nick\)/);
  const write = h.calls().find((c) => c[1] === "write");
  assert.ok(write, JSON.stringify(h.calls()));
  assert.equal(write[write.indexOf("--directory") + 1], "20 Areas/Learned");
  assert.match(write[write.indexOf("--content") + 1], /## Learned\n- \[routine\] gym at 5 most days .*\n\n## Relations\n- about \[\[Nick\]\]/);
});

test("a title read as an option or a path is refused, and basic-memory never runs", () => {
  for (const title of ["--help", "-rf", "../secrets", "notes/../../etc", "a/b", "..", "Nick/../x"]) {
    const h = fakeHome();
    const out = h.run(["learn", title, "fact", "something"]);
    assert.notEqual(out.status, 0, title);
    assert.match(out.stderr, /title/i, title);
    assert.deepEqual(h.calls(), [], title);
  }
});

test("ranked search asks for full results so excerpts are shown", () => {
  assert.ok(!bmArgs.search("gym").includes("--compact"));
  assert.ok(bmArgs.search("gym").includes("--json"));
});
