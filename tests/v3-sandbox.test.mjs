// The V3 sandbox runs ORION's real calendar scripts against a private day and
// never touches Nick's live files (2026-10-08: an unsplit env string once sent
// orion-reschedule to the real bridge — the preflight exists to catch that).
import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { tokenize, createSandbox } from "../scripts/lib/eval/v3/sandbox.mjs";

test("tokenize splits like a shell without being one", () => {
  assert.deepEqual(tokenize(`orion-reschedule add "gym and laundry" 120 --at 11:15`), ["orion-reschedule", "add", "gym and laundry", "120", "--at", "11:15"]);
  assert.deepEqual(tokenize(`orion-tasks add 'say "hi"'`), ["orion-tasks", "add", `say "hi"`]);
  assert.deepEqual(tokenize("/Users/x/Desktop/ORION/scripts/orion-agenda today"), ["/Users/x/Desktop/ORION/scripts/orion-agenda", "today"]);
  for (const bad of ["orion-agenda today | head", "a && b", "a; b", "a > f", "echo $(x)", "a `b`"]) assert.throws(() => tokenize(bad), /shell/, bad);
});

const live = ["reschedule-undo.json", "pins.json", "life-config.json", "life-history.jsonl", "patterns.json"]
  .map((f) => join(homedir(), ".openclaw/orion-controlled", f));
const stamps = () => live.map((f) => { try { return statSync(f).mtimeMs; } catch { return null; } });

test("a sandbox day: real scripts read and change it; live files are untouched; others are refused", async () => {
  const before = stamps();
  const sb = createSandbox({ now: "14:00", day: [
    { title: "CS lab", start: "15:00", end: "16:00", fixed: true },
    { title: "Study", start: "16:30", end: "17:30", kind: "study" },
  ], todos: ["finish resume"] });
  try {
    assert.equal(await sb.preflight(), true);
    const agenda = await sb.run("orion-agenda today");
    assert.equal(agenda.exit, 0);
    assert.match(agenda.stdout, /CS lab/);
    const move = await sb.run(`orion-reschedule move "Study" --to 19:30`);
    assert.match(move.stdout, /Study moved/);
    const study = sb.state().day.find((e) => e.title === "Study");
    assert.equal(study.start, 19 * 60 + 30);
    assert.deepEqual(sb.state().todos, ["finish resume"]);
    const refused = await sb.run("orion-wake 07:30");
    assert.equal(refused.exit, null);
    assert.match(refused.stdout, /not run in the sandbox/);
    const piped = await sb.run("orion-agenda today | head");
    assert.match(piped.stdout, /shell/);
  } finally {
    sb.cleanup();
  }
  assert.deepEqual(stamps(), before);
});
