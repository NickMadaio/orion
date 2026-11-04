// w18 note: `orion-brain learn` cut a fact at 400 characters and flattened line breaks silently. A long note must be kept whole.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BRAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-brain");

function vault() {
  const dir = mkdtempSync(join(tmpdir(), "orion-brain-long-"));
  const file = join(dir, "Nick.md");
  writeFileSync(file, '---\ntitle: Nick\n---\n# Nick\n\n## Learned\n- [said] old line (2026-10-01)\n\n## Relations\n- about [[Gym]]\n');
  mkdirSync(join(dir, "home"));
  const run = (args) => spawnSync(process.execPath, [BRAIN, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: join(dir, "home"), ORION_BRAIN_VAULT: dir } });
  return { run, read: () => readFileSync(file, "utf8") };
}

const LONG = "so for the cs1802 project we need to pick the dataset by friday and priya said the graph one is easier but i think the sorting one is cooler. " +
  "also tell dr. smith the lab report is late because the printer broke and i was at the library till 11 and then the wifi died and then i just gave up honestly. " +
  "and book the dentist for after exams because i keep forgetting and my teeth are fine but mum keeps asking and she will not stop until i do it so yeah";

test("learn keeps a long multi-sentence note whole, past 400 characters", () => {
  assert.ok(LONG.length > 400);
  const h = vault();
  const out = h.run(["learn", "Nick", "note", LONG]);
  assert.equal(out.status, 0, out.stderr);
  assert.ok(h.read().includes(LONG), "the whole note is on disk");
  assert.ok(h.read().includes("## Relations"), "the line went under Learned, before Relations");
});

test("learn keeps line breaks as one line, never a forged heading or bullet", () => {
  const h = vault();
  const out = h.run(["learn", "Nick", "note", "first thing\n## Evil\n- second thing\nthird"]);
  assert.equal(out.status, 0, out.stderr);
  const disk = h.read();
  assert.ok(!/^## Evil/m.test(disk));
  assert.match(disk, /first thing ⏎ ## Evil ⏎ - second thing ⏎ third/);
});

test("learn still refuses an absurd length rather than cutting silently", () => {
  const h = vault();
  const out = h.run(["learn", "Nick", "note", "word ".repeat(2000)]);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr + out.stdout, /too long/i);
  assert.ok(!h.read().includes("word word word"));
});
