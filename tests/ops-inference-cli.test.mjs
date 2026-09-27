import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const SCRIPT = join(process.cwd(), "scripts/orion-costs");

function runScript(args, envOverrides = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...envOverrides },
  });
}

describe("ops-inference-cli", () => {
  let tmp;

  before(() => {
    tmp = join(tmpdir(), `orion-costs-${randomUUID()}`);
    mkdirSync(tmp, { recursive: true });
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("a ledger is summarized per model", () => {
    const ledgerPath = join(tmp, "ledger.jsonl");
    const now = Date.now();
    const dayMs = 86_400_000;

    // Write two entries for model-a and one for model-b
    const lines = [
      JSON.stringify({
        ts: new Date(now - dayMs).toISOString(),
        model: "model-a",
        outcome: "succeeded",
        tokens: { input: 100, output: 50 },
        estimated_cost_usd: 0.001,
        latency_ms: 120,
      }),
      JSON.stringify({
        ts: new Date(now - dayMs * 2).toISOString(),
        model: "model-a",
        outcome: "succeeded",
        tokens: { input: 200, output: 100 },
        estimated_cost_usd: 0.002,
        latency_ms: 200,
      }),
      JSON.stringify({
        ts: new Date(now - dayMs * 3).toISOString(),
        model: "model-b",
        outcome: "failed",
        tokens: { input: 50, output: 10 },
        estimated_cost_usd: 0.0005,
        latency_ms: 80,
      }),
    ];
    writeFileSync(ledgerPath, lines.join("\n"));

    const result = runScript(["--file", ledgerPath, "--days", "7", "--now", new Date(now).toISOString()]);

    assert.strictEqual(result.status, 0);
    const stdout = result.stdout;
    assert.match(stdout, /Inference, last 7 day\(s\)/);
    assert.match(stdout, /model-a/);
    assert.match(stdout, /model-b/);
    assert.match(stdout, /Total/);
    // model-a should appear before model-b (sorted by cost desc)
    const aIdx = stdout.indexOf("model-a");
    const bIdx = stdout.indexOf("model-b");
    assert.ok(aIdx < bIdx, "model-a should come before model-b by cost");
  });

  it("--json prints the summary", () => {
    const ledgerPath = join(tmp, "ledger-json.jsonl");
    const now = Date.now();
    const dayMs = 86_400_000;

    const lines = [
      JSON.stringify({
        ts: new Date(now - dayMs).toISOString(),
        model: "test-model",
        outcome: "succeeded",
        tokens: { input: 10, output: 5 },
        estimated_cost_usd: 0.0001,
        latency_ms: 50,
      }),
    ];
    writeFileSync(ledgerPath, lines.join("\n"));

    const result = runScript(["--file", ledgerPath, "--days", "7", "--now", new Date(now).toISOString(), "--json"]);

    assert.strictEqual(result.status, 0);
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      assert.fail("stdout was not valid JSON");
    }
    assert.ok(parsed.totals, "summary has totals");
    assert.ok(parsed.byModel, "summary has byModel");
    assert.ok(parsed.byDay, "summary has byDay");
    assert.strictEqual(parsed.byModel["test-model"].calls, 1);
  });

  it("a missing ledger is not an error", () => {
    const result = runScript(["--file", join(tmp, "nonexistent.jsonl")]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /No inference recorded\./);
  });

  it("bad --days is refused", () => {
    const result = runScript(["--days", "abc"]);

    assert.strictEqual(result.status, 2);
  });
});
