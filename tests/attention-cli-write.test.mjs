import { strict as assert } from "node:assert";
import { before, describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "orion-attention");

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: env.HOME },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("attention-cli-write", () => {
  let tmp;
  let file;

  before(async () => {
    tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
    file = join(tmp, "attention.json");
  });

  it.after(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("add then list shows the new item", () => {
    const addResult = run(["add", "Buy milk", "--file", file]);
    assert.equal(addResult.status, 0, `add failed: ${addResult.stderr}`);
    assert.match(addResult.stdout, /added manual:/);

    const listResult = run(["list", "--file", file]);
    assert.equal(listResult.status, 0, `list failed: ${listResult.stderr}`);
    assert.match(listResult.stdout, /Buy milk/);
  });

  it("ack removes an item from the open list", () => {
    // First add an item
    const addResult = run(["add", "Call dentist", "--file", file]);
    assert.equal(addResult.status, 0, `add failed: ${addResult.stderr}`);
    const idMatch = addResult.stdout.match(/added (manual:[a-f0-9]+)/);
    assert(idMatch, "could not extract id from add output");
    const id = idMatch[1];

    // Ack it
    const ackResult = run(["ack", id, "--file", file]);
    assert.equal(ackResult.status, 0, `ack failed: ${ackResult.stderr}`);
    assert.match(ackResult.stdout, /acknowledged/);

    // List should not show it as open
    const listResult = run(["list", "--file", file]);
    assert.equal(listResult.status, 0, `list failed: ${listResult.stderr}`);
    assert.doesNotMatch(listResult.stdout, /Call dentist/);
  });

  it("snooze hides an item until its time", () => {
    // Add an item
    const addResult = run(["add", "Pick up dry cleaning", "--file", file]);
    assert.equal(addResult.status, 0, `add failed: ${addResult.stderr}`);
    const idMatch = addResult.stdout.match(/added (manual:[a-f0-9]+)/);
    assert(idMatch, "could not extract id from add output");
    const id = idMatch[1];

    // Snooze until far in the future
    const future = new Date(Date.now() + 86400000 * 365).toISOString();
    const snoozeResult = run(["snooze", id, "--until", future, "--file", file]);
    assert.equal(snoozeResult.status, 0, `snooze failed: ${snoozeResult.stderr}`);
    assert.match(snoozeResult.stdout, /snoozed/);

    // List should not show it as open (still snoozed)
    const listResult = run(["list", "--file", file]);
    assert.equal(listResult.status, 0, `list failed: ${listResult.stderr}`);
    assert.doesNotMatch(listResult.stdout, /Pick up dry cleaning/);
  });

  it("bad input is refused with a message", () => {
    // add with --urgency 3 (out of range) should exit 2
    const badAdd = run(["add", "Bad urgency item", "--urgency", "3", "--file", file]);
    assert.equal(badAdd.status, 2, `expected exit 2 for bad urgency, got ${badAdd.status}`);
    assert.match(badAdd.stderr, /urgency/);

    // ack with unknown id should exit 1
    const badAck = run(["ack", "nope", "--file", file]);
    assert.equal(badAck.status, 1, `expected exit 1 for unknown id, got ${badAck.status}`);
    assert.match(badAck.stderr, /no attention item/);
  });

  it("prune counts what it removed", () => {
    // Add an item and ack it so prune can remove old acked items
    const addResult = run(["add", "Old task to prune", "--file", file]);
    assert.equal(addResult.status, 0, `add failed: ${addResult.stderr}`);
    const idMatch = addResult.stdout.match(/added (manual:[a-f0-9]+)/);
    assert(idMatch, "could not extract id from add output");
    const id = idMatch[1];

    // Ack it
    run(["ack", id, "--file", file]);

    // Prune — acked items older than 1 week are pruned, but this one is fresh.
    // So prune should remove 0 (or we need an expired item).
    // Let's add an expired item instead.
    const past = new Date(Date.now() - 86400000).toISOString();
    run(["add", "Expired task", "--expires", past, "--file", file]);

    const pruneResult = run(["prune", "--file", file]);
    assert.equal(pruneResult.status, 0, `prune failed: ${pruneResult.stderr}`);
    assert.match(pruneResult.stdout, /pruned \d+ item/);
  });
});
