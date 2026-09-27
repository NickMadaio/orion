import { describe, it, after } from "node:test";
import { strict as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = join(dirname(new URL(import.meta.url).pathname), "..", "scripts", "orion-focus-report");

function run(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: env },
  });
}

describe("ops-focus-cli", () => {
  it("a history prints per day", () => {
    const tmp = join(tmpdir(), `orion-att-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    after(() => rmSync(tmp, { recursive: true, force: true }));

    const histPath = join(tmp, "focus-history.jsonl");
    // Two sessions on 2025-01-10, one on 2025-01-11
    writeFileSync(
      histPath,
      JSON.stringify({ startedAt: "2025-01-10T10:00:00Z", servedFocusSeconds: 1800, task: "coding", completedFocusBlocks: 3 }) + "\n" +
      JSON.stringify({ startedAt: "2025-01-10T14:00:00Z", servedFocusSeconds: 900, task: "review", completedFocusBlocks: 1, reason: "early" }) + "\n" +
      JSON.stringify({ startedAt: "2025-01-11T09:00:00Z", servedFocusSeconds: 3600, task: "deep work", completedFocusBlocks: 5 }) + "\n"
    );

    const result = run(["--file", histPath, "--days", "7", "--now", "2025-01-12T00:00:00Z"], tmp);
    assert.strictEqual(result.status, 0);
    const out = result.stdout;
    assert.ok(out.includes("Focus, last 7 day(s):"), `header missing: ${out}`);
    assert.ok(out.includes("3 session(s)"), `total sessions wrong: ${out}`);
    assert.ok(out.includes("2025-01-10"), `day 10 missing: ${out}`);
    assert.ok(out.includes("2025-01-11"), `day 11 missing: ${out}`);
    assert.ok(out.includes("Longest:"), `longest line missing: ${out}`);
    assert.ok(out.includes("deep work"), `longest task missing: ${out}`);
  });

  it("--json prints the report", () => {
    const tmp = join(tmpdir(), `orion-att-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    after(() => rmSync(tmp, { recursive: true, force: true }));

    const histPath = join(tmp, "focus-history.jsonl");
    writeFileSync(
      histPath,
      JSON.stringify({ startedAt: "2025-01-10T10:00:00Z", servedFocusSeconds: 1800, task: "coding", completedFocusBlocks: 3 }) + "\n"
    );

    const result = run(["--file", histPath, "--days", "7", "--now", "2025-01-12T00:00:00Z", "--json"], tmp);
    assert.strictEqual(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.totals, "totals key missing");
    assert.strictEqual(parsed.totals.sessions, 1);
    assert.ok(parsed.byDay, "byDay key missing");
    assert.ok(parsed.longest, "longest key missing");
    assert.strictEqual(typeof parsed.skipped, "number", "skipped should be a number");
  });

  it("missing history is not an error", () => {
    const tmp = join(tmpdir(), `orion-att-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    after(() => rmSync(tmp, { recursive: true, force: true }));

    // No file at all
    const result = run(["--file", join(tmp, "nonexistent.jsonl"), "--days", "7", "--now", "2025-01-12T00:00:00Z"], tmp);
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes("No focus sessions recorded."), `expected message missing: ${result.stdout}`);
  });

  it("bad --days is refused", () => {
    const tmp = join(tmpdir(), `orion-att-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    after(() => rmSync(tmp, { recursive: true, force: true }));

    const result = run(["--file", join(tmp, "x.jsonl"), "--days", "abc"], tmp);
    assert.strictEqual(result.status, 2);
  });
});

