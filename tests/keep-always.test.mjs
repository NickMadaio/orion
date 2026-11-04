// w18 keep: "keep vorsaint at all times" must save the app on the keep list, resolved fuzzily to the real app name, and the list must protect it from
// quit-unused (and the bedtime quit). Nothing here quits a real app: stub sources, temp dirs, a mock bridge.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { editDistance, resolveAppName } from "../scripts/lib/apps/resolve.mjs";
import { addKeep, alwaysKept, keepListSay, loadConfig, removeKeep } from "../scripts/lib/apps/gameconfig.mjs";
import { quitUnused } from "../scripts/lib/apps/run.mjs";
import { keptReason } from "../scripts/lib/apps/policy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), "keep-always-"));
const CANDIDATES = [{ name: "Vorssaint", bundleId: "com.vorssaint.utils" }, { name: "Spotify", bundleId: "com.spotify.client" }, { name: "Discord", bundleId: "com.hnc.Discord" },
  { name: "Google Chrome", bundleId: "com.google.Chrome" }, { name: "Notes", bundleId: "com.apple.Notes" }, { name: "Epic Games Launcher", bundleId: "com.epicgames.EpicGamesLauncher" }];

test("edit distance counts insert, delete and swap-as-two", () => {
  assert.equal(editDistance("vorsaint", "vorssaint"), 1);
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("discrod", "discord"), 1);
  assert.equal(editDistance("", "abc"), 3);
});

test("resolve: typos and shortenings find the real app, unrelated words do not", () => {
  for (const [said, want] of [["vorsaint", "Vorssaint"], ["vorssaint", "Vorssaint"], ["Vorsaint", "Vorssaint"], ["vorssiant", "Vorssaint"], ["spotfy", "Spotify"], ["discrod", "Discord"],
    ["chrome", "Google Chrome"], ["epic", "Epic Games Launcher"], ["epic games", "Epic Games Launcher"]])
    assert.equal(resolveAppName(said, CANDIDATES)?.name, want, said);
  for (const said of ["music", "zzz", "my homework", "no", "vorsa"]) assert.equal(resolveAppName(said, CANDIDATES), null, said);
});

test("keep add: stores the resolved name and bundle id, says it will always leave it open, is idempotent", () => {
  const dir = tmp();
  const a = addKeep(dir, ["vorsaint"], { candidates: CANDIDATES });
  assert.equal(a.say, "I'll always leave Vorssaint open.");
  const c = loadConfig(dir);
  assert.ok(c.keep.includes("Vorssaint")); assert.deepEqual(c.always, ["Vorssaint"]); assert.deepEqual(c.alwaysIds, ["com.vorssaint.utils"]);
  assert.equal(addKeep(dir, ["vorssaint"], { candidates: CANDIDATES }).changed, false);
  assert.equal(loadConfig(dir).always.length, 1);
  assert.equal(addKeep(dir, ["Vorsaint", "Spotfy"], { candidates: CANDIDATES }).say, "I'll always leave Spotify open.");
});

test("keep add: an app that is not installed is kept by the name he typed", () => {
  const dir = tmp();
  assert.equal(addKeep(dir, ["Obsidian"], { candidates: CANDIDATES }).say, "I'll always leave Obsidian open.");
  assert.deepEqual(loadConfig(dir).always, ["Obsidian"]);
});

test("the defaults protect a game only; only what he adds is kept everywhere", () => {
  const dir = tmp();
  assert.deepEqual(alwaysKept(dir), { names: [], ids: [] });
  addKeep(dir, ["vorsaint"], { candidates: CANDIDATES });
  assert.deepEqual(alwaysKept(dir), { names: ["Vorssaint"], ids: ["com.vorssaint.utils"] });
});

test("keep remove: fuzzy, leaves the others, and says so when it was not kept", () => {
  const dir = tmp();
  addKeep(dir, ["vorsaint", "obsidian"], { candidates: CANDIDATES });
  const r = removeKeep(dir, ["vorsaint"], { candidates: CANDIDATES });
  assert.match(r.say, /Vorssaint/);
  assert.deepEqual(loadConfig(dir).always, ["obsidian"]);
  assert.deepEqual(loadConfig(dir).alwaysIds, []);
  assert.match(removeKeep(dir, ["zorblax"], { candidates: CANDIDATES }).say, /wasn't on the keep list/);
});

test("keep list say: what he always keeps open, and the game-only defaults", () => {
  const dir = tmp();
  assert.match(keepListSay(loadConfig(dir)), /nothing.*always/i);
  addKeep(dir, ["vorsaint"], { candidates: CANDIDATES });
  assert.match(keepListSay(loadConfig(dir)), /always leave Vorssaint open/);
  assert.match(keepListSay(loadConfig(dir)), /Discord/);   // the game defaults are named too
});

test("quit-unused: a kept app survives even when buried, and a typo'd saved name still matches", async () => {
  const mk = (o) => ({ name: "App", bundleId: "x", pid: 1, path: "/Applications/App.app", kind: "regular", frontmost: false, windows: 0, onscreen: 0, rank: null, audible: false, document: false, ...o });
  const apps = [mk({ name: "Vorssaint", bundleId: "com.vorssaint.utils", pid: 2 }), mk({ name: "Steam", pid: 3 })];
  const log = [];
  const alive = new Set([2, 3]);
  const src = { snapshot: () => apps.filter((a) => alive.has(a.pid)), alive: (p) => alive.has(p), identity: (p) => (alive.has(p) ? { comm: `/x/${p}`, start: "t" } : null), tree: (a) => [{ pid: a.pid, name: a.name, comm: `/x/${a.pid}`, start: "t" }],
    quit: (a) => { log.push(a.name); alive.delete(a.pid); }, hide: () => true, signal: () => {}, windowCount: () => 0, ownsTree: () => false, sleep: async () => {} };
  const r = await quitUnused(src, { keep: ["vorsaint"] });   // the misspelling, as saved before resolution existed
  assert.deepEqual(log, ["Steam"]);
  assert.match(r.say, /Vorssaint \(on your keep list\)/);
  assert.match(keptReason(mk({ name: "Vorssaint" }), { keep: ["Vorsaint"], all: true }), /keep list/);
  assert.equal(keptReason(mk({ name: "Notes" }), { keep: ["safari"], all: true }), null);
});

// The real script, with an installed-apps folder of its own so nothing depends on this Mac.
function cli(dir, apps, ...args) {
  const r = spawnSync("node", [join(here, "..", "scripts", "orion-apps"), ...args], { encoding: "utf8", env: { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_APPS_INSTALLED_DIRS: apps } });
  return { code: r.status, out: r.stdout.trim() };
}
test("orion-apps game-prep keep add vorsaint --json: the 11-03 request saves Vorssaint", () => {
  const dir = tmp(), apps = tmp();
  mkdirSync(join(apps, "Vorssaint.app")); mkdirSync(join(apps, "Safari.app"));
  const r = cli(dir, apps, "game-prep", "keep", "add", "vorsaint", "--json");
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).say, "I'll always leave Vorssaint open.");
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "game-prep.json"), "utf8")).always, ["Vorssaint"]);
  const list = cli(dir, apps, "game-prep", "keep", "list", "--json");
  assert.match(JSON.parse(list.out).say, /always leave Vorssaint open/);
  const gone = cli(dir, apps, "game-prep", "keep", "remove", "vorsaint", "--json");
  assert.match(JSON.parse(gone.out).say, /Vorssaint/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "game-prep.json"), "utf8")).always, []);
});

// Bedtime: the wrapper refuses a kept app, by bundle id or by name inside it, before it ever reaches the bridge.
test("orion-bedtime-act quit-app refuses an app he keeps open at all times", () => {
  const dir = tmp(), bridgeDir = tmp(), bin = join(bridgeDir, "bridge"), log = join(bridgeDir, "req.json");
  writeFileSync(bin, `#!/usr/bin/env node\nrequire("fs").writeFileSync(${JSON.stringify(log)}, "called");\nconsole.log(JSON.stringify({ id: "1", ok: true, result: { status: "done" } }));\n`);
  chmodSync(bin, 0o755);
  const at = (h, m = 0, d = 3) => new Date(2026, 10, d, h, m).toISOString();
  writeFileSync(join(dir, "wake-plan.json"), JSON.stringify({ source: "nick", alarms: [{ iso: at(7, 0, 4), byNick: true }], bedtimes: [{ nudgeAtIso: at(23) }] }));
  writeFileSync(join(dir, "game-prep.json"), JSON.stringify({ version: 1, autoPrep: true, keep: ["Vorssaint", "Discord"], always: ["Vorssaint"], alwaysIds: ["com.vorssaint.utils"] }));
  const run = (id) => spawnSync("node", [join(here, "..", "scripts", "orion-bedtime-act"), "quit-app", id, "--now", at(23, 30)],
    { encoding: "utf8", env: { ...process.env, ORION_MAC_BRIDGE: bin, ORION_CONTROLLED_DIR: dir } });
  // Discord is a distraction app and only on the game list: bedtime still quits it. A kept distraction app (his Chrome) is spared.
  assert.equal(run("com.hnc.Discord").status, 0);
  assert.equal(existsSync(log), true);
  writeFileSync(join(dir, "game-prep.json"), JSON.stringify({ version: 1, keep: [], always: ["Google Chrome"], alwaysIds: ["com.google.Chrome"] }));
  const kept = run("com.google.Chrome");
  assert.equal(kept.status, 1); assert.match(kept.stderr, /keep that app open at all times/i);
  writeFileSync(join(dir, "game-prep.json"), JSON.stringify({ version: 1, keep: [], always: ["Discord"] }));   // no id saved: the name inside the bundle id matches
  assert.equal(run("com.hnc.Discord").status, 1);
});
