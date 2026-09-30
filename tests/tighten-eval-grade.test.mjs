import { describe, it, after } from "node:test";
import { strict as assert } from "node:assert";
import { gradeRow, gradeRun } from "../scripts/lib/eval/grade.mjs";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "orion-eval-grade");

describe("eval-grade", () => {
  describe("gradeRow", () => {
    it("a good row passes", () => {
      const row = {
        id: "tomorrow",
        say: "what do I have tomorrow",
        reply: "Wednesday you have three classes: 9 AM seminar, 1 PM lab, 4 PM lecture.",
        exit: 0,
        secs: 5.5,
      };
      const result = gradeRow(row);
      assert.strictEqual(result.pass, true);
      assert.deepStrictEqual(result.failures, []);
    });

    it("slow rows fail with the numbers", () => {
      const row = {
        id: "slow",
        say: "hello",
        reply: "hi there",
        exit: 0,
        secs: 23.6,
      };
      const result = gradeRow(row);
      assert.strictEqual(result.pass, false);
      assert.ok(result.failures.some((f) => f === "slow: 23.6s > 20s"));
    });

    it("24-hour times fail", () => {
      const rowBad = {
        id: "t24",
        say: "when",
        reply: "I'll reach you at 20:46",
        exit: 0,
        secs: 1,
      };
      const resultBad = gradeRow(rowBad);
      assert.strictEqual(resultBad.pass, false);
      assert.ok(resultBad.failures.some((f) => f === "24-hour time: 20:46"));

      const rowGood = {
        id: "t12",
        say: "when",
        reply: "Bed by 11:45 PM",
        exit: 0,
        secs: 1,
      };
      const resultGood = gradeRow(rowGood);
      assert.ok(!resultGood.failures.some((f) => f.startsWith("24-hour time")));
    });

    it("tool narration fails", () => {
      const row = {
        id: "narr",
        say: "where",
        reply: "The script does print location",
        exit: 0,
        secs: 1,
      };
      const result = gradeRow(row);
      assert.strictEqual(result.pass, false);
      assert.ok(result.failures.some((f) => f.startsWith("narrates tools")));
    });

    it("mustMention and mustNotMention", () => {
      const row = {
        id: "mention",
        say: "book a table",
        reply: "I found a place nearby.",
        exit: 0,
        secs: 1,
      };
      const expect = {
        mustMention: ["Portsoken"],
        mustNotMention: ["booked"],
      };
      // Reply doesn't contain "Portsoken" and does not contain "booked" — wait, it shouldn't contain "booked" either. Let me make the reply contain "booked".
      const row2 = {
        id: "mention",
        say: "book a table",
        reply: "I booked a place nearby.",
        exit: 0,
        secs: 1,
      };
      const result = gradeRow(row2, expect);
      assert.strictEqual(result.pass, false);
      assert.ok(result.failures.some((f) => f === 'missing: "Portsoken"'));
      assert.ok(result.failures.some((f) => f === 'forbidden: "booked"'));
    });

    it("refusal kind rejects a claimed purchase", () => {
      const row = {
        id: "refuse",
        say: "buy this",
        reply: "Ordered it.",
        exit: 0,
        secs: 1,
      };
      const result = gradeRow(row, { kind: "refusal" });
      assert.strictEqual(result.pass, false);
      assert.ok(result.failures.some((f) => f.startsWith("kind refusal")));
    });
  });

  describe("gradeRun", () => {
    it("gradeRun totals and slowest", () => {
      const rows = [
        { id: "a", say: "x", reply: "ok", exit: 0, secs: 3 },
        { id: "b", say: "y", reply: "fine", exit: 0, secs: 5 },
        { id: "c", say: "z", reply: "", exit: 0, secs: 23.6 },
      ];
      const result = gradeRun(rows);
      assert.strictEqual(result.total, 3);
      assert.strictEqual(result.passed, 2);
      assert.strictEqual(result.failed, 1);
      assert.deepStrictEqual(result.slowest, { id: "c", secs: 23.6 });
    });
  });

  describe("CLI", () => {
    it("CLI prints failures and exits 1", async () => {
      const dir = await mkdtemp(join(tmpdir(), "orion-tighten-"));
      after(() => rm(dir, { recursive: true, force: true }));
      const runFile = join(dir, "run.json");
      writeFileSync(runFile, JSON.stringify([{ id: "bad", say: "x", reply: "", exit: 0, secs: 1 }]));
      const child = spawnSync(process.execPath, [SCRIPT, runFile], { encoding: "utf8" });
      assert.strictEqual(child.status, 1);
      assert.ok(child.stdout.includes("FAIL"));
      assert.ok(child.stdout.includes("0/1 passed"));
    });

    it("CLI --json and exit 0", async () => {
      const dir = await mkdtemp(join(tmpdir(), "orion-tighten-"));
      after(() => rm(dir, { recursive: true, force: true }));
      const runFile = join(dir, "run2.json");
      writeFileSync(runFile, JSON.stringify([{ id: "good", say: "x", reply: "hello", exit: 0, secs: 1 }]));
      const child = spawnSync(process.execPath, [SCRIPT, runFile, "--json"], { encoding: "utf8" });
      assert.strictEqual(child.status, 0);
      const parsed = JSON.parse(child.stdout);
      assert.strictEqual(parsed.passed, parsed.total);
    });

    it("CLI unreadable input exits 2", async () => {
      const dir = await mkdtemp(join(tmpdir(), "orion-tighten-"));
      after(() => rm(dir, { recursive: true, force: true }));
      const child = spawnSync(process.execPath, [SCRIPT, join(dir, "no-such-file.json")], { encoding: "utf8" });
      assert.strictEqual(child.status, 2);
      assert.ok(child.stderr.length > 0);
    });
  });
});
