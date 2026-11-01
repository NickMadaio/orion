// Knowledge seeds, canary files and the premises that are checked or declared unmet: apply, effect, undo, verify.
// A fake home; nothing here touches the real brain vault or the real canary folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths } from "../lib/live.mjs";
import { applyFixtures, fixtureProblems, planFixtures, readManifest, restoreFixtures } from "../lib/fixtures.mjs";
import { applyPlan, planSetup } from "../lib/setup.mjs";
import { effectSince, restoreState, snapshotState, verifyRestore } from "../lib/state.mjs";
import { validateScenarios } from "../lib/scenarios.mjs";

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), "gate-fx-"));
  const ctrl = join(home, ".openclaw/orion-controlled");
  const scripts = join(home, "scripts");
  for (const d of [ctrl, join(home, ".openclaw/tools/node-v24.15.0/bin"), join(home, ".openclaw/workspace/memory"), scripts, join(home, "vault/00 Inbox"), join(home, "canary"), join(home, "Apps/Notes.app")]) mkdirSync(d, { recursive: true });
  symlinkSync(process.execPath, join(home, ".openclaw/tools/node-v24.15.0/bin/node"));
  writeFileSync(join(scripts, "orion-session"), `#!${process.execPath}\nconsole.log(JSON.stringify({ status: "finished" }));\n`);
  chmodSync(join(scripts, "orion-session"), 0o755);
  writeFileSync(join(home, "vault/00 Inbox/real-note.md"), "# real\n");
  writeFileSync(join(home, "canary/c1.txt"), "canary 1");
  writeFileSync(join(ctrl, "life-config.json"), JSON.stringify({ bedtime: "01:00" }));
  process.env.ORION_SCRIPTS = scripts;
  const p = { ...paths(home), brainVault: join(home, "vault"), canary: join(home, "canary"), appDirs: [join(home, "Apps")] };
  return { home, ctrl, p };
}

const setup = {
  knowledge: [{ title: "Annika", body: "Annika is a friend. Plans on 10-19: dinner." }, { title: "Saved entries", body: "- Saved: Frozen." }],
  canary: { "old-notes/note.txt": "old", "junk.txt": "junk" },
};

test("planFixtures: knowledge notes land in the vault inbox with a gate-fixture prefix, canary files in the test folder", async () => {
  const { p } = fakeHome();
  const plan = await planFixtures(p, setup);
  assert.deepEqual(plan.files.map((f) => f.path.slice(p.home.length + 1)),
    ["vault/00 Inbox/gate-fixture-annika.md", "vault/00 Inbox/gate-fixture-saved-entries.md", "canary/old-notes/note.txt", "canary/junk.txt"]);
  assert.match(plan.files[0].content, /title: Annika/);
  assert.match(plan.files[0].content, /Plans on 10-19: dinner/);
  assert.equal(plan.applied.length, 4);
  assert.deepEqual(plan.unmet, []);
});

test("applyFixtures writes the manifest and files; restoreFixtures removes them and the directories it created, and leaves the real files", async () => {
  const { p, ctrl } = fakeHome();
  const { files } = await planFixtures(p, setup);
  applyFixtures(p, files);
  assert.ok(existsSync(join(p.brainVault, "00 Inbox/gate-fixture-annika.md")));
  assert.equal(readFileSync(join(p.canary, "junk.txt"), "utf8"), "junk");
  assert.equal(readManifest(p).files.length, 4);
  assert.deepEqual(readManifest(p).dirs, [join(p.canary, "old-notes")]);
  const actions = restoreFixtures(p);
  assert.equal(actions.filter((a) => a.startsWith("removed fixture")).length, 4);
  assert.ok(!existsSync(join(p.canary, "old-notes")), "the directory the setup created is gone");
  assert.deepEqual(readdirSync(p.canary), ["c1.txt"]);
  assert.deepEqual(readdirSync(join(p.brainVault, "00 Inbox")), ["real-note.md"]);
  assert.deepEqual(fixtureProblems({ ...p, ctrl }), []);
});

test("applyFixtures refuses to overwrite an existing file and writes nothing", async () => {
  const { p } = fakeHome();
  const { files } = await planFixtures(p, { canary: { "c1.txt": "mine", "new.txt": "x" } });
  assert.throws(() => applyFixtures(p, files), /already exist/);
  assert.equal(readFileSync(join(p.canary, "c1.txt"), "utf8"), "canary 1");
  assert.ok(!existsSync(join(p.canary, "new.txt")));
  assert.equal(readManifest(p), null);
});

test("a fixture path outside the vault and the canary folder is refused", () => {
  const { p } = fakeHome();
  assert.throws(() => applyFixtures(p, [{ kind: "canary", path: join(p.home, "elsewhere.txt"), content: "x" }]), /outside/);
});

test("a manifest cannot make the undo delete outside the vault and the canary folder", () => {
  const { p, ctrl, home } = fakeHome();
  const victim = join(home, "precious.txt");
  writeFileSync(victim, "keep");
  writeFileSync(join(ctrl, "eval-fixtures.json"), JSON.stringify({ files: [{ kind: "canary", path: victim, sha: "x" }], dirs: [home] }));
  assert.match(restoreFixtures(p)[0], /REFUSED/);
  assert.equal(readFileSync(victim, "utf8"), "keep");
});

test("full cycle: setup applies the seeds, the item forgets one and edits one, the effect says so, undo restores and verifies", async () => {
  const { p } = fakeHome();
  const snap = await snapshotState(p);
  const plan = await planSetup(p, setup, { writable: new Map(), sessionId: snap.sessionId });
  applyPlan(p, plan);
  assert.ok(existsSync(join(p.brainVault, "00 Inbox/gate-fixture-saved-entries.md")));
  assert.ok(existsSync(join(p.ctrl, "eval-fixtures.json")));
  const base = await snapshotState(p);
  // The item "forgets" the junk note and edits the person note.
  writeFileSync(join(p.brainVault, "00 Inbox/gate-fixture-annika.md"), "changed");
  (await import("node:fs")).rmSync(join(p.brainVault, "00 Inbox/gate-fixture-saved-entries.md"));
  const effect = await effectSince(p, base);
  assert.deepEqual(effect.fixtures.map((f) => [f.file, f.status]),
    [["00 Inbox/gate-fixture-annika.md", "changed"], ["00 Inbox/gate-fixture-saved-entries.md", "removed"], ["old-notes/note.txt", "kept"], ["junk.txt", "kept"]]);
  assert.equal(effect.changedAnything, true);
  await restoreState(p, snap, effect);
  const verified = await verifyRestore(p, snap);
  assert.deepEqual(verified.problems, []);
  assert.deepEqual(readdirSync(join(p.brainVault, "00 Inbox")), ["real-note.md"]);
  assert.deepEqual(readdirSync(p.canary), ["c1.txt"]);
  assert.ok(!existsSync(join(p.ctrl, "eval-fixtures.json")));
});

test("verifyRestore reports a gate-fixture note that is still in the vault", async () => {
  const { p } = fakeHome();
  const snap = await snapshotState(p);
  writeFileSync(join(p.brainVault, "00 Inbox/gate-fixture-stray.md"), "x");
  const v = await verifyRestore(p, snap);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((x) => /gate-fixture-stray/.test(x)));
});

test("needs: unmet kinds give their reason, checkable kinds are checked", async () => {
  const { p } = fakeHome();
  const needs = [
    { need: "focus_running", detail: "econ 50 min" }, { need: "screen", detail: "Preview slide 4" }, { need: "ambient", detail: "tv" },
    { need: "history", detail: "slips" }, { need: "location", detail: "home" }, { need: "outreach_unlinked", detail: "x" },
    { need: "apps_installed", apps: ["Notes"] }, { need: "apps_installed", apps: ["Safari"] },
    { need: "config_is", key: "bedtime", value: "01:00" }, { need: "config_is", key: "bedtime", value: "00:00" },
    { need: "file_exists", file: "life-config.json" }, { need: "file_exists", file: "health-log.json" },
  ];
  const plan = await planFixtures(p, { needs }, { sessionId: null });
  assert.equal(plan.unmet.length, 9);
  assert.match(plan.unmet[0], /focus_running: econ 50 min \(the Mac app owns the focus session/);
  assert.match(plan.unmet[1], /screen: Preview slide 4 \(.*cannot be set up/);
  assert.match(plan.unmet.find((u) => u.startsWith("apps_installed")), /Safari not found/);
  assert.match(plan.unmet.find((u) => u.startsWith("config_is")), /live setting is 01:00/);
  assert.match(plan.unmet.find((u) => u.startsWith("file_exists")), /health-log.json \(missing\)/);
  assert.ok(plan.applied.some((a) => a.startsWith("apps_installed:Notes")));
  assert.ok(plan.applied.some((a) => a.startsWith("config_is:bedtime=01:00")));
});

test("needs focus_idle: met when the snapshot saw no session, unmet when one is running, deferred in a dry run", async () => {
  const { p } = fakeHome();
  const idle = [{ need: "focus_idle" }];
  assert.match((await planFixtures(p, { needs: idle }, { sessionId: null })).applied[0], /reports no running session/);
  assert.match((await planFixtures(p, { needs: idle }, { sessionId: "s-9" })).unmet[0], /s-9 is running/);
  assert.match((await planFixtures(p, { needs: idle }, {})).applied[0], /checked against orion-session status when the item runs/);
});

test("validateScenarios accepts the new setup keys and rejects malformed ones", () => {
  const item = (setupPart) => ({ id: "x", area: "a", wording: "vague", writes: false, setup: setupPart, turns: [{ text: "hi" }], expect: { rubric: "r" } });
  assert.deepEqual(validateScenarios([item({ knowledge: [{ title: "A", body: "b" }], canary: { "a/b.txt": "x" }, needs: [{ need: "screen" }] })]), []);
  assert.match(validateScenarios([item({ knowledge: [{ title: "A" }] })])[0], /title and a body/);
  assert.match(validateScenarios([item({ canary: { "../x": "y" } })])[0], /relative path/);
  assert.match(validateScenarios([item({ needs: [{ need: "teleport" }] })])[0], /need must be one of/);
});

test("vault: a note the item appends to, a new Learned note and a deleted note are reported, then restored and verified", async () => {
  const { p } = fakeHome();
  mkdirSync(join(p.brainVault, "20 Areas/Me"), { recursive: true });
  writeFileSync(join(p.brainVault, "20 Areas/Me/Nick.md"), "# Nick\n- likes tea\n");
  writeFileSync(join(p.brainVault, "00 Inbox/old.md"), "old\n");
  const snap = await snapshotState(p);
  const fs = await import("node:fs");
  fs.appendFileSync(join(p.brainVault, "20 Areas/Me/Nick.md"), "- hates being called buddy, no emojis\n");
  mkdirSync(join(p.brainVault, "20 Areas/Learned"), { recursive: true });
  writeFileSync(join(p.brainVault, "20 Areas/Learned/prefs.md"), "- no emojis\n");
  fs.rmSync(join(p.brainVault, "00 Inbox/old.md"));
  const effect = await effectSince(p, snap);
  assert.deepEqual(effect.vault.changed.map((c) => [c.path, c.added]), [["20 Areas/Me/Nick.md", ["- hates being called buddy, no emojis"]]]);
  assert.deepEqual(effect.vault.created.map((c) => c.path), ["20 Areas/Learned/prefs.md"]);
  assert.deepEqual(effect.vault.deleted.map((c) => c.path), ["00 Inbox/old.md"]);
  assert.equal(effect.changedAnything, true);
  assert.equal((await verifyRestore(p, snap)).ok, false);
  const actions = await restoreState(p, snap, effect);
  assert.ok(actions.some((a) => /restored vault note 20 Areas\/Me\/Nick.md/.test(a)));
  const v = await verifyRestore(p, snap);
  assert.deepEqual(v.problems, []);
  assert.equal(readFileSync(join(p.brainVault, "20 Areas/Me/Nick.md"), "utf8"), "# Nick\n- likes tea\n");
  assert.ok(!existsSync(join(p.brainVault, "20 Areas/Learned")), "the folder the item created is gone");
  assert.equal(readFileSync(join(p.brainVault, "00 Inbox/old.md"), "utf8"), "old\n");
});

test("vault: dot folders are not the vault's notes and an untouched vault reports nothing", async () => {
  const { p } = fakeHome();
  mkdirSync(join(p.brainVault, ".obsidian"), { recursive: true });
  const snap = await snapshotState(p);
  writeFileSync(join(p.brainVault, ".obsidian/workspace.md"), "ui state");
  const effect = await effectSince(p, snap);
  assert.deepEqual(effect.vault, { created: [], changed: [], deleted: [] });
  assert.deepEqual((await verifyRestore(p, snap)).problems, []);
});
