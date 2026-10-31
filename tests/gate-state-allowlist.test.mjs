// REV2 finding 10 (2026-10-31): the gate's restore rewound every small .json in the controlled dir, including files the live system owns
// (location.json, remote-inbound.json, proactive-sent.json, ...), wiping phone messages and re-sending pings. Only the allow-list is restored;
// everything else is reported.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectSince, restoreState, snapshotState, trackedFiles } from "../scripts/eval/gate/lib/state.mjs";

function fakePaths() {
  const root = mkdtempSync(join(tmpdir(), "gate-state-"));
  const p = { ctrl: join(root, "ctrl"), workspace: join(root, "ws"), scripts: join(root, "scripts"), undo: join(root, "ctrl", "undo.json"), node: process.execPath };
  for (const d of [p.ctrl, p.workspace, p.scripts]) mkdirSync(d, { recursive: true });
  return p;
}
const LIVE_OWNED = ["location.json", "remote-inbound.json", "proactive-sent.json", "cron-delivery.json", "selfdev-queue.json", "permission-state.json",
  "usage-cache.json", "account-health.json", "sleep-actual.json", "morning-brief.json"];

test("trackedFiles is the allow-list only: live-owned files are never restorable", () => {
  const p = fakePaths();
  for (const f of LIVE_OWNED) writeFileSync(join(p.ctrl, f), "{}\n");
  const tracked = trackedFiles(p).map((f) => f.split("/").at(-1));
  for (const f of LIVE_OWNED) assert.ok(!tracked.includes(f), f);
  for (const f of ["reminders.json", "declared-facts.json", "chat-quiet.json"]) assert.ok(tracked.includes(f), f);
});

test("a live-owned file changed during an item is reported and left as it is; an allow-listed one is restored", async () => {
  const p = fakePaths();
  writeFileSync(join(p.ctrl, "remote-inbound.json"), '{"messages":["old"]}\n');
  writeFileSync(join(p.ctrl, "declared-facts.json"), '{"facts":[]}\n');
  const snap = await snapshotState(p);
  writeFileSync(join(p.ctrl, "remote-inbound.json"), '{"messages":["old","from his phone"]}\n');
  writeFileSync(join(p.ctrl, "location.json"), '{"place":"library"}\n');
  writeFileSync(join(p.ctrl, "declared-facts.json"), '{"facts":["from the item"]}\n');
  const effect = await effectSince(p, snap);
  assert.deepEqual(effect.reported.map((r) => r.path).sort(), ["location.json", "remote-inbound.json"]);
  const actions = await restoreState(p, snap, effect);
  assert.equal(readFileSync(join(p.ctrl, "remote-inbound.json"), "utf8"), '{"messages":["old","from his phone"]}\n');
  assert.ok(existsSync(join(p.ctrl, "location.json")));
  assert.equal(readFileSync(join(p.ctrl, "declared-facts.json"), "utf8"), '{"facts":[]}\n');
  assert.ok(!actions.some((a) => /remote-inbound|location/.test(a)), actions.join("\n"));
});
