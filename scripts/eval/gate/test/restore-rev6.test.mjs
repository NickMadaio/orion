// REV6 items 7 and 8: what the gate's undo does to things that are not the item's.
//   7. vault restore deleted any .md that appeared during the item and overwrote changed notes (his own, or a daily note written in
//      that window): they now go to orion-controlled/gate-vault-quarantine/<run>/ first, and the report names them.
//   8. trash-log.jsonl was truncated: the row of a real file trashed during the item was lost (the file stays in the Trash, but
//      restore cannot find it). It is now reported, not rewound. memory-archive.jsonl stays paired with the vault restore.
// A fake home; nothing here touches the real vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths } from "../lib/live.mjs";
import { effectSince, restoreState, snapshotState, verifyRestore } from "../lib/state.mjs";

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), "gate-rev6-"));
  const ctrl = join(home, ".openclaw/orion-controlled");
  const scripts = join(home, "scripts");
  for (const d of [ctrl, join(home, ".openclaw/tools/node-v24.15.0/bin"), join(home, ".openclaw/workspace/memory"), scripts, join(home, "vault/20 Areas/Me"), join(home, "vault/Daily"), join(home, "canary")]) mkdirSync(d, { recursive: true });
  symlinkSync(process.execPath, join(home, ".openclaw/tools/node-v24.15.0/bin/node"));
  writeFileSync(join(scripts, "orion-session"), `#!${process.execPath}\nconsole.log(JSON.stringify({ status: "finished" }));\n`);
  chmodSync(join(scripts, "orion-session"), 0o755);
  writeFileSync(join(home, "vault/20 Areas/Me/Nick.md"), "# Nick\n## Learned\n- likes tea\n- partner is Priya\n");
  writeFileSync(join(home, "vault/Projects.md"), "# Projects\n- Atlas\n");
  process.env.ORION_SCRIPTS = scripts;
  const p = { ...paths(home), brainVault: join(home, "vault"), canary: join(home, "canary") };
  return { home, ctrl, p };
}

test("a note that appeared and a note that changed during the item are quarantined before the restore, and reported", async () => {
  const { ctrl, p } = fakeHome();
  const snap = await snapshotState(p);
  writeFileSync(join(p.brainVault, "Daily/2026-11-01.md"), "# today\n- wrote this myself\n");
  appendFileSync(join(p.brainVault, "Projects.md"), "- Orion widgets\n");
  const effect = await effectSince(p, snap);
  const actions = await restoreState(p, snap, effect, { runId: "run-x/item-1" });
  const q = join(ctrl, "gate-vault-quarantine", "run-x-item-1");
  assert.equal(readFileSync(join(q, "Daily/2026-11-01.md"), "utf8"), "# today\n- wrote this myself\n");
  assert.equal(readFileSync(join(q, "Projects.md"), "utf8"), "# Projects\n- Atlas\n- Orion widgets\n");
  assert.ok(actions.some((a) => a.includes("quarantined") && a.includes("Daily/2026-11-01.md")), actions.join("\n"));
  assert.ok(actions.some((a) => a.includes("quarantined") && a.includes("Projects.md")));
  assert.equal(readFileSync(join(p.brainVault, "Projects.md"), "utf8"), "# Projects\n- Atlas\n");
  assert.ok(!existsSync(join(p.brainVault, "Daily/2026-11-01.md")));
  assert.deepEqual((await verifyRestore(p, snap)).problems, []);
});

test("a real trash-log row written during the item is reported and kept; the forget's archive row goes with its vault line", async () => {
  const { ctrl, p } = fakeHome();
  writeFileSync(join(ctrl, "trash-log.jsonl"), `${JSON.stringify({ id: "old", from: "/x/a.txt", to: "/x/.Trash/a.txt" })}\n`);
  const snap = await snapshotState(p);
  const row = JSON.stringify({ id: "t2", from: "/x/Desktop/real.txt", to: "/x/.Trash/real.txt" });
  appendFileSync(join(ctrl, "trash-log.jsonl"), `${row}\n`);
  // A forget during the item: the line leaves the vault note and is archived.
  writeFileSync(join(p.brainVault, "20 Areas/Me/Nick.md"), "# Nick\n## Learned\n- likes tea\n");
  appendFileSync(join(ctrl, "memory-archive.jsonl"), `${JSON.stringify({ id: "abc", store: "vault", file: "20 Areas/Me/Nick.md", line: 4, raw: "- partner is Priya", archivedAt: "t" })}\n`);
  const effect = await effectSince(p, snap);
  const actions = await restoreState(p, snap, effect, { runId: "r" });
  assert.ok(readFileSync(join(ctrl, "trash-log.jsonl"), "utf8").includes(row), "the row restore needs is still there");
  assert.ok(actions.some((a) => /^REPORTED trash-log\.jsonl/.test(a) && a.includes("real.txt")), actions.join("\n"));
  assert.ok(!existsSync(join(ctrl, "memory-archive.jsonl")) || readFileSync(join(ctrl, "memory-archive.jsonl"), "utf8") === "", "the archive row is gone with the vault line back");
  assert.match(readFileSync(join(p.brainVault, "20 Areas/Me/Nick.md"), "utf8"), /partner is Priya/);
  assert.ok(!actions.some((a) => /HAZARD.*memory-archive/.test(a)));
  assert.deepEqual((await verifyRestore(p, snap)).problems, []);
});

test("an archive row whose line is NOT back after the restore is kept and flagged, not silently dropped", async () => {
  const { ctrl, p } = fakeHome();
  const snap = await snapshotState(p);
  // A row naming a file the gate does not restore (outside the vault and the workspace's tracked files).
  appendFileSync(join(ctrl, "memory-archive.jsonl"), `${JSON.stringify({ id: "zz", store: "vault", file: "Elsewhere/none.md", line: 1, raw: "- gone for good", archivedAt: "t" })}\n`);
  const actions = await restoreState(p, snap, await effectSince(p, snap), { runId: "r" });
  assert.ok(actions.some((a) => /HAZARD memory-archive\.jsonl/.test(a)), actions.join("\n"));
  assert.match(readFileSync(join(ctrl, "memory-archive.jsonl"), "utf8"), /gone for good/, "the only record of that line is kept");
});
