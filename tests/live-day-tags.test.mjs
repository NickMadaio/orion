// Spec 4.0 C-day: live-day returns `logged`, `rank` and `tags` on each block, which the day review and the curiosity loop read.
// Through the real bridge protocol (the fake bridge stores [orion:kind][tag]... as orionTags, as the real one returns it).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const BRIDGE = join(import.meta.dirname, "fixtures/fake-bridge.mjs");

test("a block created with tags reads back with tags, rank and logged; an untagged one has none", () => {
  const home = mkdtempSync(join(tmpdir(), "orion-liveday-"));
  const cal = join(home, "cal.json");
  const env = { PATH: process.env.PATH, HOME: home, ORION_BRIDGE_BIN: BRIDGE, FAKE_CALENDAR: cal };
  const day = new Date(2026, 9, 16);
  const at = (h) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, 0).toISOString();
  writeFileSync(cal, "[]");
  const create = (title, start, end, orionKind, orionTags) => spawnSync(process.execPath, [BRIDGE], { env,
    input: `${JSON.stringify({ id: "1", action: "create_calendar_event", payload: { title, start, end, orionKind, orionTags } })}\n`, encoding: "utf8" });
  create("finish resume", at(11), at(12), "study", "rank-high,logged");
  create("lunch", at(13), at(14), "meal", "");
  const out = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { liveDay } from ${JSON.stringify(join(import.meta.dirname, "../scripts/lib/life/live-day.mjs"))}; console.log(JSON.stringify(await liveDay("2026-10-16")));`],
    { env, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  const [resume, lunch] = JSON.parse(out.stdout);
  assert.deepEqual(resume.tags, ["rank-high", "logged"]);
  assert.equal(resume.rank, "high");
  assert.equal(resume.logged, true);
  assert.deepEqual(lunch.tags, []);
  assert.equal(lunch.logged, false);
  assert.equal(lunch.rank, undefined);
});
