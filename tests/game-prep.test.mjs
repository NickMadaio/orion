// orion-apps game-prep (w18 gamemode): the keep/close plan with a stub process table (Minecraft's java tree kept, Epic closed, a browser with a
// save prompt kept and reported), the keep list file, the session record, and idle-model unload with a stubbed Ollama. Nothing touches a real app.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gamePrep, planGamePrep } from "../scripts/lib/apps/gameprep.mjs";
import { DEFAULT_KEEP, addKeep, loadConfig, removeKeep, setAutoPrep, lastPrepSay } from "../scripts/lib/apps/gameconfig.mjs";
import { unloadIdleModels } from "../scripts/lib/apps/ollama.mjs";

const app = (o) => ({ name: "App", bundleId: "com.x.app", pid: 100, path: "/Applications/App.app", kind: "regular", frontmost: false, windows: 0, onscreen: 0, rank: null, audible: false, document: false, ...o });
const MC = app({ name: "Minecraft Launcher", bundleId: "com.mojang.minecraftlauncher", pid: 10, path: "/Applications/Minecraft.app", frontmost: true, windows: 1, onscreen: 1, rank: 0 });
const JAVA = app({ name: "java", bundleId: "", pid: 11, path: "/Library/Java/JavaVirtualMachines/jdk/Contents/Home/bin/java", kind: "accessory" });
const EPIC = app({ name: "Epic Games Launcher", bundleId: "com.epicgames.EpicGamesLauncher", pid: 20, path: "/Applications/Epic Games Launcher.app", kind: "accessory" });
const STEAM = app({ name: "Steam", bundleId: "com.valvesoftware.steam", pid: 21, path: "/Applications/Steam.app" });
const CHROME = app({ name: "Google Chrome", bundleId: "com.google.Chrome", pid: 30, path: "/Applications/Google Chrome.app", windows: 2, onscreen: 1, rank: 1 });
const SLACK = app({ name: "Slack", bundleId: "com.tinyspeck.slackmacgap", pid: 31, path: "/Applications/Slack.app" });
const DISCORD = app({ name: "Discord", bundleId: "com.hnc.Discord", pid: 40, path: "/Applications/Discord.app", onscreen: 1, rank: 2 });
const SPOTIFY = app({ name: "Spotify", bundleId: "com.spotify.client", pid: 41, path: "/Applications/Spotify.app", audible: true });
const ORION = app({ name: "ORION", bundleId: "com.nick.orion", pid: 50, path: "/Applications/ORION.app" });
const OLLAMA = app({ name: "Ollama", bundleId: "com.electron.ollama", pid: 51, path: "/Applications/Ollama.app", kind: "accessory" });
const WORD = app({ name: "Microsoft Word", bundleId: "com.microsoft.Word", pid: 60, path: "/Applications/Microsoft Word.app", document: true, windows: 1, onscreen: 1, rank: 3 });
const ALL = [MC, JAVA, EPIC, STEAM, CHROME, SLACK, DISCORD, SPOTIFY, ORION, OLLAMA, WORD];

/** behavior[pid] = { quit: "exit"|"ignore", helpers: n, kb }. A helper outlives its app's quit until SIGTERM. An "ignore" app keeps its window up (a save or leave-site prompt). */
function stub(apps, behavior = {}) {
  const alive = new Set(apps.map((a) => a.pid));
  const helpers = new Map();
  const log = [];
  const b = (pid) => ({ quit: "exit", term: "exit", helpers: 0, kb: 100_000, ...behavior[pid] });
  apps.forEach((a) => { for (let i = 0; i < b(a.pid).helpers; i++) { const h = 1000 * a.pid + i; helpers.set(h, a.pid); alive.add(h); } });
  const owner = (pid) => (helpers.has(pid) ? helpers.get(pid) : pid);
  return {
    log, alive: (pid) => alive.has(pid),
    snapshot: () => apps.filter((a) => alive.has(a.pid)),
    tree: (a) => [a.pid, ...[...helpers].filter(([h, o]) => o === a.pid && alive.has(h)).map(([h]) => h)].filter((p) => alive.has(p))
      .map((pid) => ({ pid, name: pid === a.pid ? a.name : `${a.name} Helper`, comm: `/x/${pid}`, start: "t0" })),
    identity: (pid) => (alive.has(pid) ? { comm: `/x/${pid}`, start: "t0" } : null),
    lineage: (a) => (a.pid === JAVA.pid ? [MC.pid] : []),
    memoryKB: (a) => b(a.pid).kb,
    quit: (a) => { log.push(["quit", a.pid]); if (b(a.pid).quit === "exit") alive.delete(a.pid); },
    hide: () => true,
    signal: (pid, sig) => { log.push([sig, pid]); if (sig === "SIGKILL" || (sig === "SIGTERM" && b(owner(pid)).term === "exit")) alive.delete(pid); },
    windowCount: (a) => (b(a.pid).quit === "ignore" ? a.windows : 0),
    ownsTree: () => false,
    sleep: async () => {},
  };
}
const names = (xs) => xs.map((x) => x.name);
const KEEP = ["Discord", "Spotify", "Music", "Zoom"];
const tmp = () => mkdtempSync(join(tmpdir(), "gp-"));

test("plan: Minecraft keeps its launcher and java tree, music and voice, ORION and Ollama; Epic, Steam and the rest are closed", () => {
  const plan = planGamePrep(ALL, { game: "Minecraft", keep: KEEP, src: stub(ALL) });
  assert.deepEqual(names(plan.close).sort(), ["Epic Games Launcher", "Google Chrome", "Microsoft Word", "Slack", "Steam"]);
  const why = Object.fromEntries(plan.kept.map((k) => [k.name, k.why]));
  assert.match(why["Minecraft Launcher"], /game/); assert.match(why.java, /game/);
  assert.match(why.Discord, /keep list/); assert.match(why.Spotify, /keep list/);
  assert.match(why.ORION, /never closed/); assert.match(why.Ollama, /never closed/);
});

test("plan: a bundle id names the game, and a Steam game keeps Steam because it is the game's parent", () => {
  const GAME = app({ name: "Hades", bundleId: "com.supergiant.hades", pid: 70, path: "/x/Hades.app", frontmost: true });
  const all = [GAME, STEAM, EPIC];
  const s = { ...stub(all), lineage: (a) => (a.pid === 70 ? [STEAM.pid] : []) };
  assert.deepEqual(names(planGamePrep(all, { game: "com.supergiant.hades", keep: [], src: s }).close), ["Epic Games Launcher"]);
});

test("plan: removing a default from the keep list lets that app close; a game that is not running plans nothing", () => {
  const s = stub(ALL);
  assert.ok(names(planGamePrep(ALL, { game: "Minecraft", keep: ["Spotify"], src: s }).close).includes("Discord"));
  const none = planGamePrep(ALL, { game: "Fortnite", keep: KEEP, src: s });
  assert.equal(none.gameFound, false); assert.deepEqual(none.close, []);
});

test("run: closes the plan, keeps Word and Chrome that are asking to save and reports them, counts lingering helpers", async () => {
  const s = stub(ALL, { 20: { helpers: 2 }, 31: { helpers: 2 }, 30: { quit: "ignore" }, 60: { quit: "ignore" }, 21: { kb: 2_000_000 } });
  const dir = tmp();
  const r = await gamePrep(s, { game: "Minecraft", keep: KEEP, dir, ollama: null });
  assert.equal(r.ok, true);
  assert.deepEqual(names(r.closed), ["Epic Games Launcher", "Slack", "Steam"]);
  assert.equal(r.helperCount, 4);
  assert.deepEqual(r.reported.map((x) => x.name).sort(), ["Google Chrome", "Microsoft Word"]);
  assert.match(r.reported.find((x) => x.name === "Microsoft Word").why, /save/);
  for (const a of [MC, JAVA, DISCORD, SPOTIFY, ORION, OLLAMA, CHROME, WORD]) assert.equal(s.alive(a.pid), true, a.name);
  for (const a of [EPIC, SLACK, STEAM]) assert.equal(s.alive(a.pid), false, a.name);
  assert.ok(r.freedBytes >= 2_000_000 * 1024);
  assert.match(r.headline, /^closed Epic Games Launcher, Slack, Steam and 4 helpers, freed ~\d/);
  assert.match(r.headline, /left Google Chrome and Microsoft Word open \(asking to save\)/);
  const rec = JSON.parse(readFileSync(join(dir, "game-session.json"), "utf8"));
  assert.deepEqual(rec.prep.closed.map((c) => c.name), ["Epic Games Launcher", "Slack", "Steam"]);
  assert.equal(rec.prep.closed[0].path, "/Applications/Epic Games Launcher.app");
  assert.equal(rec.prep.reported.length, 2);
  assert.equal(rec.prep.helperCount, 4);
});

test("dry run: nothing is signalled, nothing is written, the plan is in the reply", async () => {
  const s = stub(ALL);
  const dir = tmp();
  const r = await gamePrep(s, { game: "Minecraft", keep: KEEP, dir, dryRun: true, ollama: null });
  assert.equal(r.dryRun, true); assert.deepEqual(s.log, []); assert.equal(existsSync(join(dir, "game-session.json")), false);
  assert.match(r.say, /would close/i); assert.match(r.say, /Epic Games Launcher/);
  assert.deepEqual(r.closed, []);
});

test("no game and no session is not an error; a named game that is not running is one honest line", async () => {
  const r = await gamePrep(stub(ALL), { game: undefined, keep: KEEP, dir: tmp(), ollama: null });
  assert.equal(r.ok, true); assert.match(r.say, /no game/i);
  const g = await gamePrep(stub(ALL), { game: "Fortnite", keep: KEEP, dir: tmp(), ollama: null });
  assert.equal(g.ok, false); assert.match(g.say, /Fortnite/);
});

test("keep list: defaults without writing, add and remove are case-insensitive and idempotent, auto-prep persists", () => {
  const dir = tmp();
  assert.deepEqual(loadConfig(dir).keep, DEFAULT_KEEP);
  assert.equal(loadConfig(dir).autoPrep, true);
  assert.equal(existsSync(join(dir, "game-prep.json")), false);   // reading never writes
  const a = addKeep(dir, ["Obsidian", "obsidian"]);
  assert.equal(a.keep.filter((k) => /obsidian/i.test(k)).length, 1); assert.match(a.say, /Obsidian/);
  const r = removeKeep(dir, ["discord"]);
  assert.ok(!loadConfig(dir).keep.some((k) => /discord/i.test(k))); assert.match(r.say, /Discord/i);
  assert.equal(removeKeep(dir, ["nothing here"]).changed, false);
  setAutoPrep(dir, false);
  assert.equal(loadConfig(dir).autoPrep, false);
  assert.equal(JSON.parse(readFileSync(join(dir, "game-prep.json"), "utf8")).autoPrep, false);
  assert.ok(loadConfig(dir).keep.some((k) => /obsidian/i.test(k)));   // the auto flag did not drop the list
});

test("last: says what was closed, left open and unloaded, or that nothing was", () => {
  assert.match(lastPrepSay(null), /haven't closed anything/);
  const say = lastPrepSay({ game: { name: "Minecraft" }, prep: { at: "2026-11-03T20:00:00Z", closed: [{ name: "Chrome", helpers: [] }, { name: "Epic Games Launcher", helpers: ["a", "b"] }],
    helperCount: 2, reported: [{ name: "Word", why: "asking to save" }], unloaded: [{ name: "qwen3.5:9b" }], freedBytes: 6e9 } });
  for (const w of ["Minecraft", "Chrome", "Epic Games Launcher", "Word", "qwen3.5:9b"]) assert.match(say, new RegExp(w));
});

test("ollama: every loaded model except the 4b front desk is unloaded with keep_alive 0", async () => {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push([String(url), init?.method ?? "GET", init?.body ? JSON.parse(init.body) : null]);
    if (String(url).endsWith("/api/ps")) return { ok: true, json: async () => ({ models: [{ name: "qwen3.5:9b", size: 6e9 }, { name: "qwen3.5:4b-q4_K_M", size: 3.6e9 }, { name: "nomic-embed-text:latest", size: 3e8 }] }) };
    return { ok: true, json: async () => ({}) };
  };
  const r = await unloadIdleModels({ fetch: fetchStub, host: "http://127.0.0.1:11434" });
  assert.deepEqual(r.unloaded.map((m) => m.name), ["qwen3.5:9b", "nomic-embed-text:latest"]);
  assert.deepEqual(calls.filter(([, m]) => m === "POST").map(([u, , body]) => [u, body]), [
    ["http://127.0.0.1:11434/api/generate", { model: "qwen3.5:9b", keep_alive: 0 }],
    ["http://127.0.0.1:11434/api/generate", { model: "nomic-embed-text:latest", keep_alive: 0 }]]);
  assert.equal(r.freedBytes, 6e9 + 3e8);
});

test("ollama: dry run only reads; a dead server is no error and frees nothing", async () => {
  const calls = [];
  const live = async (url, init) => { calls.push(init?.method ?? "GET"); return { ok: true, json: async () => ({ models: [{ name: "qwen3.5:9b", size: 1 }] }) }; };
  const d = await unloadIdleModels({ fetch: live, host: "h", dryRun: true });
  assert.deepEqual(calls, ["GET"]); assert.deepEqual(d.unloaded.map((m) => m.name), ["qwen3.5:9b"]);
  const dead = await unloadIdleModels({ fetch: async () => { throw new Error("ECONNREFUSED"); }, host: "h" });
  assert.deepEqual(dead.unloaded, []); assert.equal(dead.freedBytes, 0);
});

test("run: model unload frees memory and is recorded", async () => {
  const f = async (url) => (String(url).endsWith("/api/ps") ? { ok: true, json: async () => ({ models: [{ name: "qwen3.5:9b", size: 6e9 }] }) } : { ok: true, json: async () => ({}) });
  const dir = tmp();
  const r = await gamePrep(stub([MC, ORION]), { game: "Minecraft", keep: KEEP, dir, ollama: { fetch: f, host: "h" } });
  assert.deepEqual(r.unloaded.map((m) => m.name), ["qwen3.5:9b"]);
  assert.ok(r.freedBytes >= 6e9); assert.match(r.headline, /unloaded|freed/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "game-session.json"), "utf8")).prep.unloaded.map((m) => m.name), ["qwen3.5:9b"]);
});

// w18 gameready: "make my computer game ready" runs now, with no game open, and closes background updaters and unknown apps too.
const ZUPD = app({ name: "ZoomUpdater", bundleId: "us.zoom.ZoomUpdater", pid: 70, path: "/Applications/zoom.us.app/ZoomUpdater.app", kind: "accessory" });
const RAZER = app({ name: "RazerGameManagerService", bundleId: "com.razer.gms", pid: 71, path: "/Library/Razer/gms.app", kind: "accessory" });
const VORS = app({ name: "Vorssaint", bundleId: "com.vorssaint.utils", pid: 72, path: "/Applications/Vorssaint.app", kind: "accessory" });
const SENT = app({ name: "Sentient OS", bundleId: "jesai.Sentient-OS-macOS", pid: 73, path: "/Applications/Sentient OS.app", kind: "accessory" });
const PASS = app({ name: "1Password", bundleId: "com.1password.1password", pid: 74, path: "/Applications/1Password.app", kind: "accessory" });
const TERM = app({ name: "Terminal", bundleId: "com.apple.Terminal", pid: 75, path: "/System/Applications/Utilities/Terminal.app", frontmost: true, windows: 2, onscreen: 1, rank: 0 });
const CODE = app({ name: "Code", bundleId: "com.microsoft.VSCode", pid: 76, path: "/Applications/Visual Studio Code.app", windows: 3 });
const NOTES = app({ name: "Notion", bundleId: "notion.id", pid: 77, path: "/Applications/Notion.app", windows: 1, onscreen: 1, rank: 1 });
const READY = [TERM, CODE, ZUPD, RAZER, VORS, SENT, PASS, DISCORD, SPOTIFY, ORION, OLLAMA, NOTES, EPIC];

test("ready (no game): background updaters, agents, unknown apps and launchers close; terminals, IDE, chat, music, ORION, Ollama, password manager stay", () => {
  const plan = planGamePrep(READY, { keep: ["Discord", "Spotify", "Zoom"], src: stub(READY), now: true });
  assert.equal(plan.gameFound, false);
  assert.deepEqual(names(plan.close).sort(), ["Epic Games Launcher", "Notion", "RazerGameManagerService", "Sentient OS", "Vorssaint", "ZoomUpdater"]);
  const why = Object.fromEntries(plan.kept.map((k) => [k.name, k.why]));
  for (const n of ["Terminal", "Code", "Discord", "Spotify", "ORION", "Ollama", "1Password"]) assert.ok(why[n], n);
});

test("ready: a named game that is open is protected with its tree; --now closes the rest and records it", async () => {
  const s = stub(ALL);
  const dir = tmp();
  const r = await gamePrep(s, { game: "Minecraft", keep: KEEP, dir, now: true, ollama: null });
  assert.equal(r.ok, true); assert.match(r.say, /Epic Games Launcher/); assert.equal(s.alive(JAVA.pid), true);
  assert.equal(JSON.parse(readFileSync(join(dir, "game-session.json"), "utf8")).prep.closed.length > 0, true);
});

test("ready: no game open still preps, says so, and dry-run signals nothing", async () => {
  const s = stub(READY);
  const dir = tmp();
  const dry = await gamePrep(s, { keep: KEEP, dir, now: true, dryRun: true, ollama: null });
  assert.equal(dry.ok, true); assert.deepEqual(s.log, []); assert.match(dry.say, /Vorssaint/); assert.match(dry.say, /ZoomUpdater/);
  const named = await gamePrep(stub(READY), { game: "Fortnite", keep: KEEP, dir, now: true, ollama: null });
  assert.equal(named.ok, true); assert.match(named.say, /Fortnite/i); assert.match(named.say, /closed/i);
  const real = await gamePrep(stub(READY), { keep: KEEP, dir: tmp(), now: true, ollama: null });
  assert.equal(real.ok, true); assert.match(real.say, /Game ready/); assert.ok(real.closed.length >= 5);
});
