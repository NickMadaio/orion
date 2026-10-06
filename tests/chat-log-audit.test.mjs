import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readTurns, findIssues, summarize } from "../scripts/lib/audit/chat-log.mjs";

const at = s => `2026-10-06T12:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000Z`;
const user = (text, s) => JSON.stringify({ type: "message", timestamp: at(s), message: { role: "user", content: `[context]\nUser message:\n${text}` } });
const said = (text, s, tools = []) => JSON.stringify({ type: "message", timestamp: at(s), message: { role: "assistant",
  content: [{ type: "text", text }, ...tools.map(command => ({ type: "toolCall", name: "exec", arguments: { command } }))] } });
const result = (text, s, isError = false, exitCode = 0) => JSON.stringify({ type: "message", timestamp: at(s), message: { role: "toolResult", content: [{ type: "text", text }], isError, details: { exitCode } } });
const kinds = lines => findIssues(readTurns(lines, { file: "f.jsonl" })).map(i => i.kind);

test("reads message lines and ignores other types and bad lines", () => {
  const turns = readTurns([JSON.stringify({ type: "model_change", modelId: "haiku" }), "not json", user("hello there orion", 0), JSON.stringify({ type: "custom" }), said("Hi.", 2)], { file: "f.jsonl" });
  assert.equal(turns.length, 2);
  assert.equal(turns[0].text, "hello there orion");
  assert.equal(turns[1].model, "haiku");
});

test("flags cannot-do and protected refusals separately", () => {
  assert.deepEqual(kinds([user("open the folder please", 0), said("I can't browse the folder from here.", 5)]), ["cannot-do"]);
  assert.deepEqual(kinds([user("read the settings file", 0), said("I can't read that file — it's in a protected path.", 5)]), ["protected-refusal"]);
});

test("flags tool errors and repeated tool calls in one turn", () => {
  const lines = [user("move the gym to six tonight", 0),
    said("", 1, ["/x/orion-reschedule move gym"]), result("NOTHING WAS CHANGED: no block", 2),
    said("", 3, ["/x/orion-reschedule move Gym"]), result("ok", 4, false, 1),
    said("Done.", 5, ["/x/orion-reschedule move gym --to 18:00"])];
  const found = kinds(lines);
  assert.equal(found.filter(k => k === "tool-error").length, 2);
  assert.equal(found.filter(k => k === "repeat-tool").length, 1);
});

test("flags rephrased requests and frustration", () => {
  const found = kinds([user("delete the marketing lecture from today", 0), said("Done.", 5), user("delete the marketing lecture from today please", 60), said("Done.", 65), user("no, i said the lecture", 90)]);
  assert.ok(found.includes("rephrase"));
  assert.ok(found.includes("user-frustration"));
});

test("flags slow replies", () => {
  assert.deepEqual(kinds([user("plan my evening for me", 0), said("Here is the plan.", 200)]), ["slow-turn"]);
  assert.deepEqual(kinds([user("plan my evening for me", 0), said("Here is the plan.", 30)]), []);
});

test("the CLI prints a markdown report and honours --since", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "orion-backlog-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "a.jsonl"), [user("open my notes folder", 0), said("I can't open folders.", 5)].join("\n"));
  await writeFile(join(dir, "b.jsonl"), [user("run the eval scenario", 0), said("I can't do that.", 5)].join("\n"));
  await writeFile(join(dir, "b.trajectory.jsonl"), JSON.stringify({ sessionKey: "agent:main:orion-eval-sched-1" }));
  const run = (...args) => spawnSync(process.execPath, ["scripts/orion-log-audit", "--dir", dir, ...args], { encoding: "utf8" });
  const report = run();
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /# ORION chat-log audit/);
  assert.match(report.stdout, /1 transcripts/, "eval sessions are skipped by default");
  assert.match(report.stdout, /## cannot-do \(1\)/);
  assert.match(run("--include-evals").stdout, /2 transcripts/);
  assert.equal(run("--since", "2999-01-01").status, 1, "nothing that new");
  assert.equal(summarize([{ kind: "cannot-do", category: "missing-capability" }]).byCategory["missing-capability"], 1);
});
