// A to-do that slipped or was given up on 2+ times in the last 3 days cools down: not auto-planned, asked about once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cooldownOf, cooldownAsk } from "../scripts/lib/life/cooldown.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-reschedule");
const BRIDGE = join(ROOT, "tests/fixtures/fake-bridge.mjs");
const DATE = "2030-10-04";
const slip = (date, title, reason = "no-room") => ({ date, at: `${date}T20:00:00Z`, planned: { title, start: 600, end: 660, kind: "study", rank: "medium" }, missedMinutes: 60, replacedBy: "x", reason });

function world(t, slips) {
  const home = mkdtempSync(join(tmpdir(), "orion-cool-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, ".openclaw/orion-controlled"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "slips.jsonl"), slips.map((s) => `${JSON.stringify(s)}\n`).join(""));
  writeFileSync(join(home, "calendar.json"), "[]");
  writeFileSync(join(home, "reminders.json"), JSON.stringify(["finish resume", "review CS lect 2"].map((title) => ({ identifier: title, title, list: "Orion" }))));
  const reach = join(home, "reach"); writeFileSync(reach, `#!/bin/sh\necho "$@" >> "${home}/reach.log"\n`); chmodSync(reach, 0o755);
  const run = (...extra) => {
    const r = spawnSync(process.execPath, [SCRIPT, "day", "--todos", "--date", DATE, ...extra], { encoding: "utf8",
      env: { ...process.env, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: join(home, "calendar.json"), FAKE_REMINDERS: join(home, "reminders.json"),
        ORION_RESCHEDULE_UNDO: join(home, "u.json"), ORION_RESCHEDULE_PINS: join(home, "p.json"), ORION_LIFE_CONFIG: join(home, "none.json"), ORION_REACH_BIN: reach } });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const titles = () => JSON.parse(readFileSync(join(home, "calendar.json"), "utf8")).map((e) => e.title);
  const said = () => { try { return readFileSync(join(home, "reach.log"), "utf8").trim().split("\n"); } catch { return []; } };
  return { run, titles, said };
}

test("cooldownOf: 2+ slips in the last 3 days cool a to-do; one, or old ones, or another title do not", () => {
  const rows = [slip("2030-10-02", "Finish resume"), slip("2030-10-03", "finish resume", "gave-up"), slip("2030-09-20", "review CS lect 2"), slip("2030-10-03", "review CS lect 2")];
  assert.deepEqual(cooldownOf("finish resume", rows, DATE), { slips: 2, days: 2 });
  assert.equal(cooldownOf("review CS lect 2", rows, DATE), null);
  assert.equal(cooldownOf("send applications", rows, DATE), null);
  assert.equal(cooldownOf("finish resume", rows, "2030-10-09"), null, "a week later it is no longer recent");
  assert.equal(cooldownAsk("finish resume", { slips: 3, days: 3 }), "Finish resume has slipped 3 days — want it today, or later this week?");
});

test("day --todos: a cooled-down to-do is not planned, is asked about (never dropped silently), and the rest still is", (t) => {
  const w = world(t, [slip("2030-10-02", "finish resume"), slip("2030-10-03", "finish resume", "gave-up")]);
  const r = w.run();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(w.titles(), ["review CS lect 2"]);
  assert.match(r.out, /ASK: Finish resume has slipped 2 days — want it today, or later this week\?/);
  assert.match(r.out, /Left out: .*finish resume \(cooling down/);
  assert.deepEqual(w.said(), [], "without --auto no message is sent: the reply says it");
});

test("day --todos --auto: the question goes out once in one message", (t) => {
  const w = world(t, [slip("2030-10-01", "finish resume"), slip("2030-10-02", "finish resume"), slip("2030-10-03", "finish resume")]);
  assert.equal(w.run("--auto").code, 0);
  assert.equal(w.said().length, 1);
  assert.match(w.said()[0], /^Finish resume has slipped 3 days — want it today, or later this week\?/);
});

test("day --todos: one slip is not enough, the to-do is planned as usual", (t) => {
  const w = world(t, [slip("2030-10-03", "finish resume")]);
  assert.equal(w.run("--auto").code, 0);
  assert.deepEqual(w.titles().sort(), ["finish resume", "review CS lect 2"]);
  assert.deepEqual(w.said(), []);
});
