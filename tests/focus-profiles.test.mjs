import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { SEED, taskKey, profileFor, rememberApps, learnFromHistory, loadProfiles, saveProfiles, bundleIdOf, nameOf } from "../scripts/lib/focus/profiles.mjs";

const T0 = Date.parse("2026-11-04T18:00:00Z");
const at = (min) => new Date(T0 + min * 60_000).toISOString();
const names = (p) => p.apps.map(nameOf);

test("seed profiles: resume wants Pages and the browser, a cs lab wants the editor and terminal, an essay wants Docs", () => {
  const store = { version: 1, tasks: {} };
  assert.deepEqual(names(profileFor(store, "Finish resume")), ["Pages", "Safari"]);
  assert.ok(profileFor(store, "finish my resume").domains.includes("docs.google.com"));
  assert.deepEqual(names(profileFor(store, "CS lab 4")), ["Visual Studio Code", "Terminal", "Safari"]);
  assert.ok(profileFor(store, "cs lab 4").domains.includes("github.com"));
  assert.ok(profileFor(store, "econ essay draft").apps.map(nameOf).includes("Safari"));
  assert.ok(profileFor(store, "econ essay draft").domains.includes("docs.google.com"));
});

test("an unknown task still gets the browser and the usual school sites", () => {
  const p = profileFor({ version: 1, tasks: {} }, "organise the garage shelves");
  assert.deepEqual(names(p), ["Safari"]);
  assert.ok(p.domains.includes("chat.openai.com") && p.domains.includes("canvas.northeastern.edu"));
  assert.equal(p.source, "default");
});

test("everything he uses is browser-first: every seed profile includes Safari", () => {
  for (const s of SEED) assert.ok(s.apps.includes("Safari"), s.id);
});

test("what he added for a task comes back for that task, on top of the kind's apps", () => {
  let store = { version: 1, tasks: {} };
  store = rememberApps(store, "Finish resume", ["Canva", "Preview"]);
  const p = profileFor(store, "finish resume");
  assert.deepEqual(names(p), ["Pages", "Safari", "Canva", "Preview"]);
  assert.equal(p.source, "task");
  assert.equal(profileFor(store, "cs lab 4").apps.map(nameOf).includes("Canva"), false);
});

test("remembering is immutable and does not duplicate", () => {
  const a = { version: 1, tasks: {} };
  const b = rememberApps(a, "resume", ["Canva"]);
  const c = rememberApps(b, "resume", ["canva", "Canva"]);
  assert.deepEqual(a, { version: 1, tasks: {} });
  assert.deepEqual(c.tasks[taskKey("resume")].apps, ["com.canva.canvaeditor"]);
});

test("task keys ignore filler words and case", () => {
  assert.equal(taskKey("Finish the Resume!"), taskKey("finish my resume"));
});

const row = (min, bundleId, category = "work", domain = null) => ({ at: at(min), bundleId, category, domain });

test("learns an app that stayed frontmost more than 2 minutes and is not a distraction", () => {
  const rows = [row(0, "com.apple.Safari", "browser", "docs.google.com"), row(5, "com.canva.canvaeditor"), row(9, "com.apple.Safari", "browser", "docs.google.com")];
  const out = learnFromHistory(rows, { from: T0, to: T0 + 12 * 60_000 });
  assert.deepEqual(out.apps.sort(), ["com.apple.Safari", "com.canva.canvaeditor"].sort());
  assert.deepEqual(out.domains, ["docs.google.com"]);
});

test("a glance under 2 minutes, a game, social, media and ORION itself are never learned", () => {
  const rows = [row(0, "com.apple.Pages"), row(1, "com.apple.Notes"), row(2, "com.mojang.minecraft", "game"), row(8, "com.hnc.Discord", "social"),
    row(14, "com.spotify.client", "media"), row(20, "com.nickmadaio.orion.app", "system"), row(30, "com.apple.finder", "system")];
  const out = learnFromHistory(rows, { from: T0, to: T0 + 40 * 60_000 });
  assert.deepEqual(out.apps, []);
});

test("exactly 2 minutes is not 'more than 2'; 2:01 is", () => {
  assert.deepEqual(learnFromHistory([row(0, "com.apple.Pages"), { at: new Date(T0 + 120_000).toISOString(), bundleId: "x.other", category: "work" }], { from: T0, to: T0 + 120_000 }).apps, []);
  assert.deepEqual(learnFromHistory([row(0, "com.apple.Pages")], { from: T0, to: T0 + 121_000 }).apps, ["com.apple.Pages"]);
});

test("a site on the blocked list is not learned even after a long stay", () => {
  const out = learnFromHistory([row(0, "com.apple.Safari", "browser", "youtube.com"), row(10, "com.apple.Safari", "browser", "github.com")], { from: T0, to: T0 + 30 * 60_000 });
  assert.deepEqual(out.domains, ["github.com"]);
});

test("history outside the session window is ignored", () => {
  const out = learnFromHistory([row(-30, "com.apple.Numbers"), row(-5, "com.apple.Pages"), row(5, "com.apple.Pages")], { from: T0, to: T0 + 4 * 60_000 });
  assert.deepEqual(out.apps, ["com.apple.Pages"]);
});

test("bundle ids and names round trip for the known apps", () => {
  assert.equal(bundleIdOf("Safari"), "com.apple.Safari");
  assert.equal(bundleIdOf("com.apple.Pages"), "com.apple.Pages");
  assert.equal(bundleIdOf("Somethingweird"), null);
  assert.equal(nameOf("com.microsoft.VSCode"), "Visual Studio Code");
});

test("store round trips through the file and survives a missing or corrupt file", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "orion-prof-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "focus-profiles.json");
  assert.deepEqual(loadProfiles(file), { version: 1, tasks: {} });
  saveProfiles(file, rememberApps({ version: 1, tasks: {} }, "resume", ["Canva"]));
  assert.deepEqual(loadProfiles(file).tasks[taskKey("resume")].apps, ["com.canva.canvaeditor"]);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(file, "{nope");
  assert.deepEqual(loadProfiles(file), { version: 1, tasks: {} });
});

test("cli: pick prints the apps, bundle ids and sites; remember persists", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "orion-prof-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { ...process.env, ORION_CONTROLLED_DIR: dir };
  const run = (...a) => spawnSync(process.execPath, ["scripts/orion-focus-profile", ...a], { encoding: "utf8", env });
  const pick = JSON.parse(run("pick", "Finish resume", "--json").stdout);
  assert.deepEqual(pick.apps.map((a) => a.name), ["Pages", "Safari"]);
  assert.equal(pick.apps[1].bundleId, "com.apple.Safari");
  assert.ok(pick.domains.includes("docs.google.com"));
  assert.equal(run("remember", "Finish resume", "--apps", "Canva", "--json").status, 0);
  assert.deepEqual(JSON.parse(run("pick", "finish resume", "--json").stdout).apps.map((a) => a.name), ["Pages", "Safari", "Canva"]);
  assert.ok(JSON.parse(await readFile(join(dir, "focus-profiles.json"), "utf8")).tasks);
});

test("cli: learn reads the activity history for the window and persists what stayed", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "orion-prof-learn-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(dir, "activity-history.jsonl"), [row(0, "com.apple.Safari", "browser", "github.com"), row(6, "com.apple.Terminal")].map((r) => JSON.stringify(r)).join("\n") + "\n");
  const env = { ...process.env, ORION_CONTROLLED_DIR: dir };
  const run = (...a) => spawnSync(process.execPath, ["scripts/orion-focus-profile", ...a], { encoding: "utf8", env });
  const out = JSON.parse(run("learn", "cs lab 4", "--from", at(0), "--to", at(14), "--json").stdout);
  assert.deepEqual(out.apps.sort(), ["com.apple.Safari", "com.apple.Terminal"]);
  const p = JSON.parse(run("pick", "cs lab 4", "--json").stdout);
  assert.ok(p.domains.includes("github.com"));
  assert.equal(run("learn", "cs lab 4", "--from", at(0), "--to", at(14), "--json").status, 0);
});
