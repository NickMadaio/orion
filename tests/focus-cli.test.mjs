import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

async function harness(t, lines = []) {
  const dir = await mkdtemp(join(tmpdir(), "orion-backlog-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const history = join(dir, "focus-history.jsonl");
  await writeFile(history, lines.map(l => JSON.stringify(l)).join("\n"));
  return (...args) => spawnSync(process.execPath, ["scripts/orion-session", ...args], {
    encoding: "utf8", env: { ...process.env, ORION_FOCUS_HISTORY: history, ORION_SESSION_SOCKET: join(dir, "none.sock") } });
}
const request = out => JSON.parse(out.split("\n").find(l => l.startsWith("DRY RUN ")).slice(8));

test("start --sequence sends a start-sequence request with seconds", async (t) => {
  const run = await harness(t);
  const r = run("start", "essay", "--sequence", "20 work, 5 break, 40 work", "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  const sent = request(r.stdout);
  assert.equal(sent.op, "start-sequence");
  assert.equal(sent.task, "essay");
  assert.deepEqual(sent.phases, [{ kind: "focus", seconds: 1200 }, { kind: "rest", seconds: 300 }, { kind: "focus", seconds: 2400 }]);
});

test("start --sequence with --from-phase and --elapsed sends only what remains", async (t) => {
  const run = await harness(t);
  const sent = request(run("start", "essay", "--sequence", "40w 10b 40w", "--from-phase", "2", "--elapsed", "4", "--dry-run").stdout);
  assert.deepEqual(sent.phases, [{ kind: "rest", seconds: 360 }, { kind: "focus", seconds: 2400 }]);
});

test("sequence cannot be mixed with blocks", async (t) => {
  const run = await harness(t);
  const r = run("start", "essay", "--sequence", "20 work", "--blocks", "3", "--dry-run");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot be combined/);
});

test("recover rebuilds the unfinished part from the last history line", async (t) => {
  const run = await harness(t, [{ reason: "early", task: "macro", plannedFocusSeconds: 4800, plannedRestSeconds: 300, servedFocusSeconds: 1200, completedFocusBlocks: 0, totalFocusBlocks: 2 }]);
  const r = run("recover", "--dry-run");
  assert.match(r.stdout, /Recovering "macro": 20m focus → 5m break → 40m focus/);
  assert.deepEqual(request(r.stdout).phases.map(p => p.seconds), [1200, 300, 2400]);
});

test("recover with --sequence uses Nick's words", async (t) => {
  const run = await harness(t, [{ reason: "abandoned", task: "essay", plannedFocusSeconds: 1800, servedFocusSeconds: 60, totalFocusBlocks: 1 }]);
  const sent = request(run("recover", "--sequence", "I had 20 minutes left, then a five-minute break, then another forty-minute block", "--dry-run").stdout);
  assert.equal(sent.task, "essay");
  assert.deepEqual(sent.phases.map(p => p.kind), ["focus", "rest", "focus"]);
});

test("recover says nothing to recover after a completed session", async (t) => {
  const run = await harness(t, [{ reason: "completed", task: "essay", plannedFocusSeconds: 1800, servedFocusSeconds: 1800, totalFocusBlocks: 1 }]);
  const r = run("recover", "--dry-run");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Nothing to recover: the last session \(essay\) finished normally/);
  assert.doesNotMatch(r.stdout, /DRY RUN/);
});

test("end, stop and done mean finish; cancel means abandon (2026-10-07)", async (t) => {
  const run = await harness(t);
  for (const word of ["end", "stop", "done"]) {
    const r = run(word, "--dry-run");
    assert.doesNotMatch(r.stderr, /unknown command/, word);
  }
  assert.doesNotMatch(run("cancel", "--dry-run").stderr, /unknown command/);
});
