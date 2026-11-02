// orion-questions, end to end through the script (wave 12 L1).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-questions");
const NOW = new Date(2026, 10, 2, 15).toISOString();

function env({ vault = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "orion-questions-"));
  const ctl = join(root, "ctl"); mkdirSync(ctl);
  const vaultDir = join(root, "vault"); mkdirSync(join(vaultDir, "20 Areas/Me"), { recursive: true });
  writeFileSync(join(vaultDir, "20 Areas/Me/Nick.md"), "---\ntitle: Nick\n---\n\n## Learned\n- [fact] DS lab partner is Priya (2026-10-16)\n");
  return { root, ctl, vaultDir, vars: { ORION_CONTROLLED_DIR: ctl, ORION_NOW: NOW, ORION_BRIDGE_BIN: "/nonexistent", ...(vault ? { ORION_BRAIN_VAULT: vaultDir } : {}) } };
}
const run = (e, ...args) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, ORION_BRAIN_VAULT: "", ...e.vars }, encoding: "utf8" });
const rows = (e) => readFileSync(join(e.ctl, "questions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("add, dedupe, list --open, edit, drop", () => {
  const e = env();
  const a = run(e, "add", "Who is Sam?", "--why", "he said he'd lift with Sam", "--topic", "person", "--priority", "high");
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /^Added q-[0-9a-f]{6}: Who is Sam\?/);
  const id = rows(e)[0].id;
  const dup = run(e, "add", "whos sam");
  assert.match(dup.stdout, new RegExp(`Already on the list as ${id}`));
  assert.equal(rows(e).length, 1);
  run(e, "add", "Does he prefer gym mornings or evenings?", "--topic", "preference");
  const list = run(e, "list", "--open");
  assert.match(list.stdout, /Open questions \(2\)/);
  assert.match(list.stdout, /\[high, person\] Who is Sam\? \(why: he said he'd lift with Sam\)/);
  const ed = run(e, "edit", id, "Who is Sam to him?", "--priority", "normal");
  assert.equal(ed.status, 0, ed.stderr);
  assert.equal(rows(e)[0].q, "Who is Sam to him?");
  const dr = run(e, "drop", id, "--why", "found out");
  assert.match(dr.stdout, /^Dropped/);
  assert.match(run(e, "list", "--open").stdout, /Open questions \(1\)/);
  assert.equal(run(e, "drop", id).status, 3);
});

test("answer keeps a dated #orion line in his Nick note", () => {
  const e = env();
  run(e, "add", "Who is Sam?", "--topic", "person");
  const id = rows(e)[0].id;
  const out = run(e, "answer", id, "my gym buddy from uni");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Kept in his Nick note/);
  const note = readFileSync(join(e.vaultDir, "20 Areas/Me/Nick.md"), "utf8");
  assert.match(note, /- \[answer\] Who is Sam\? → my gym buddy from uni #orion \(2026-11-02\)/);
  assert.equal(rows(e)[0].status, "answered");
});

test("an isolated run without a vault seam never touches real notes: the line goes to the outbox", () => {
  const e = env({ vault: false });
  run(e, "add", "Who is Sam?");
  const id = rows(e)[0].id;
  const out = run(e, "answer", id, "gym buddy", "--json");
  assert.equal(JSON.parse(out.stdout).kept, "outbox");
  assert.match(readFileSync(join(e.ctl, "isolated-outbox.jsonl"), "utf8"), /gym buddy #orion/);
});

test("bad arguments save nothing", () => {
  const e = env();
  assert.equal(run(e, "add").status, 2);
  assert.equal(run(e, "answer", "nope", "x").status, 2);
  assert.equal(run(e, "add", "x?", "--priority", "urgent").status, 3);
  assert.equal(run(e, "frobnicate").status, 2);
  assert.ok(!existsSync(join(e.ctl, "questions.jsonl")) || readFileSync(join(e.ctl, "questions.jsonl"), "utf8") === "");
});

test("next and asked: one a day", () => {
  const e = env();
  run(e, "add", "Who is Sam?");
  const id = rows(e)[0].id;
  assert.match(run(e, "next").stdout, new RegExp(`Next to ask: ${id}`));
  assert.equal(run(e, "asked", id, "--via", "chat", "--text", "Question for you: Who is Sam?").status, 0);
  assert.equal(rows(e)[0].status, "asked");
  assert.match(run(e, "next").stdout, /Nothing to ask right now/);
});
