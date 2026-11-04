// orion-reminders end to end against a throwaway state dir and a stub orion-reach (w19-reminders).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const BIN = join(import.meta.dirname, "../scripts/orion-reminders");
const setup = (list, now = "2026-11-04T17:00:30") => {
  const dir = mkdtempSync(join(tmpdir(), "remcli-"));
  writeFileSync(join(dir, "reminders.json"), JSON.stringify(list));
  const stub = join(dir, "reach-stub");
  writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$1" >> "${dir}/said.txt"\necho "Sent — his phone (notification + chat) (the Mac is locked)."\n`);
  chmodSync(stub, 0o755);
  const env = { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_REACH_BIN: stub, ORION_NOW: now, TZ: "Europe/London" };
  const run = (...a) => spawnSync(process.execPath, [BIN, ...a], { env, encoding: "utf8" });
  return { dir, run };
};
const due = new Date("2026-11-04T17:00:00").getTime();

test("tick fires a due reminder through the reach binary, once, and list/today/snooze/done work on it", () => {
  const { dir, run } = setup([{ id: "a1", kind: "alarm", label: "call mom", dueAt: due, createdAt: due - 1000 }]);
  assert.match(run("tick").stdout, /Fired a1 \(due\): Reminder: call mom\./);
  assert.equal(run("tick").stdout.trim(), "Nothing due.");
  assert.equal(readFileSync(join(dir, "said.txt"), "utf8").trim().split("\n").length, 1);
  assert.match(run("snooze", "10").stdout, /Snoozed until 5:10 PM/);
  assert.match(run("list").stdout, /a1  call mom at 5:10 PM/);
  assert.equal(run("done").status, 0);
  assert.equal(run("list").stdout.trim(), "No reminders set.");
});

test("today lists what is left, and snooze with nothing fired refuses", () => {
  const { run } = setup([{ id: "a2", kind: "alarm", label: "gym", dueAt: new Date("2026-11-04T18:30:00").getTime(), createdAt: 1 }]);
  assert.equal(run("today").stdout.trim(), "Reminders today: gym at 6:30 PM.");
  assert.equal(run("snooze", "10").status, 1);
});
