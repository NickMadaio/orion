import { describe, it, after } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(process.cwd(), "scripts", "orion-attention-collect");

describe("orion-attention-collect", () => {
  it("a pass writes the queue and the feed and prints the digest", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
    after(async () => rm(tmp, { recursive: true, force: true }));

    const queueFile = join(tmp, "queue.json");
    const feedFile = join(tmp, "feed.json");
    const calFile = join(tmp, "calendar.json");
    const waitFile = join(tmp, "waiting.json");
    const focusFile = join(tmp, "focus.jsonl");

    // Calendar fixture: one event starting soon
    await writeFile(
      calFile,
      JSON.stringify([
        {
          identifier: "evt-001",
          title: "Team standup",
          start: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      ])
    );

    // Waiting fixture: one overdue item
    await writeFile(
      waitFile,
      JSON.stringify({
        version: 1,
        items: [
          {
            id: "w-001",
            status: "open",
            who: "Alice",
            what: "code review",
            dueBy: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
            expect: "by EOD yesterday",
            surfaced: 0,
          },
        ],
      })
    );

    // Focus history fixture: empty (no focus today)
    await writeFile(focusFile, "");

    const now = new Date().toISOString();

    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--queue", queueFile,
        "--feed", feedFile,
        "--calendar-json", calFile,
        "--waiting-json", waitFile,
        "--focus-history", focusFile,
        "--now", now,
      ],
      { encoding: "utf8", env: { ...process.env } }
    );

    assert.strictEqual(result.status, 0, `CLI exited with ${result.status}: ${result.stderr}`);

    // Digest should have been printed
    assert.ok(result.stdout.length > 0, "digest was not printed");

    // Queue file should exist and be valid JSON
    const { readFileSync } = await import("node:fs");
    const queueData = JSON.parse(readFileSync(queueFile, "utf8"));
    assert.strictEqual(queueData.version, 1);
    assert.ok(Array.isArray(queueData.items));
    assert.ok(queueData.items.length > 0, "queue should have items from calendar and waiting");

    // Feed file should exist and be valid JSON
    const feedData = JSON.parse(readFileSync(feedFile, "utf8"));
    assert.strictEqual(feedData.version, 1);
    assert.ok(Array.isArray(feedData.interrupt));
    assert.ok(Array.isArray(feedData.today));
  });

  it("dry run writes nothing", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
    after(async () => rm(tmp, { recursive: true, force: true }));

    const queueFile = join(tmp, "queue.json");
    const feedFile = join(tmp, "feed.json");
    const calFile = join(tmp, "calendar.json");

    await writeFile(calFile, JSON.stringify([]));

    const now = new Date().toISOString();

    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--queue", queueFile,
        "--feed", feedFile,
        "--calendar-json", calFile,
        "--now", now,
        "--dry-run",
      ],
      { encoding: "utf8", env: { ...process.env } }
    );

    assert.strictEqual(result.status, 0, `CLI exited with ${result.status}: ${result.stderr}`);

    // Digest should have been printed
    assert.ok(result.stdout.length > 0, "digest was not printed");

    // Files should NOT exist
    const { existsSync } = await import("node:fs");
    assert.ok(!existsSync(queueFile), "queue file should not be written in dry-run");
    assert.ok(!existsSync(feedFile), "feed file should not be written in dry-run");
  });

  it("a missing input file is an outage in the digest", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
    after(async () => rm(tmp, { recursive: true, force: true }));

    const queueFile = join(tmp, "queue.json");
    const feedFile = join(tmp, "feed.json");
    // Do NOT create calendar file — it's missing

    const now = new Date().toISOString();

    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--queue", queueFile,
        "--feed", feedFile,
        "--calendar-json", join(tmp, "nonexistent-calendar.json"),
        "--now", now,
      ],
      { encoding: "utf8", env: { ...process.env } }
    );

    // Should exit 0 (outage is reported in digest, not as error)
    assert.strictEqual(result.status, 0, `CLI exited with ${result.status}: ${result.stderr}`);

    // Digest should mention the outage
    assert.ok(
      result.stdout.toLowerCase().includes("calendar") || result.stdout.toLowerCase().includes("could not read"),
      "digest should mention the calendar outage"
    );
  });

  it("missing required flags are refused", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "orion-att-"));
    after(async () => rm(tmp, { recursive: true, force: true }));

    // Test missing --queue
    const result1 = spawnSync(
      process.execPath,
      [SCRIPT, "--feed", join(tmp, "feed.json")],
      { encoding: "utf8", env: { ...process.env } }
    );
    assert.strictEqual(result1.status, 2, "missing --queue should exit 2");

    // Test missing --feed
    const result2 = spawnSync(
      process.execPath,
      [SCRIPT, "--queue", join(tmp, "queue.json")],
      { encoding: "utf8", env: { ...process.env } }
    );
    assert.strictEqual(result2.status, 2, "missing --feed should exit 2");

    // Test missing both
    const result3 = spawnSync(
      process.execPath,
      [SCRIPT],
      { encoding: "utf8", env: { ...process.env } }
    );
    assert.strictEqual(result3.status, 2, "missing both should exit 2");
  });
});
