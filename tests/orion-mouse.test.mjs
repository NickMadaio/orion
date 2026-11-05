// orion-mouse (wave 18): button and action words, strict contract validation, atomic re-read writes, and the CLI against a temp state dir.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buttonLabel, parseAction, parseButton, parseKeys, resolveApp } from "../scripts/lib/mouse/names.mjs";
import { assertBindings, emptyBindings, validAction } from "../scripts/lib/mouse/store.mjs";

const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-mouse");
const DEVICES = { version: 1, devices: [{ id: "5426:153", name: "Razer Basilisk V3", transport: "USB", buttonCount: 11, extraButtons: [3, 4, 5], connected: true, setupState: "new" }] };

function sandbox({ devices = DEVICES, bindings } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mouse-"));
  mkdirSync(join(dir, "mouse"));
  if (devices) writeFileSync(join(dir, "mouse", "devices.json"), JSON.stringify(devices));
  if (bindings !== undefined) writeFileSync(join(dir, "mouse", "bindings.json"), typeof bindings === "string" ? bindings : JSON.stringify(bindings));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [bin, ...args, "--json"], { encoding: "utf8", env: { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_MOUSE_NO_LOOKUP: "1" } });
    return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null, err: r.stderr };
  };
  const bindingsNow = () => JSON.parse(readFileSync(join(dir, "mouse", "bindings.json"), "utf8"));
  return { dir, run, bindingsNow };
}

test("buttons: words, 1-based numbers, bare CGEvent numbers, and what is refused or ambiguous", () => {
  for (const [said, n] of [["back", 3], ["side back", 3], ["the back side button", 3], ["rear side", 3], ["front", 4], ["forward", 4], ["front side button", 4], ["button 4", 3], ["button 5", 4], ["mouse button 6", 5], ["Btn 7", 6], ["3", 3], ["5", 5]]) {
    assert.deepEqual(parseButton(said), { n }, said);
  }
  assert.deepEqual(parseButton("side button"), { ask: "button" });
  assert.deepEqual(parseButton(""), { ask: "button" });
  assert.deepEqual(parseButton("back and front"), { ask: "button" });
  for (const bad of ["left click", "right", "middle", "button 1", "button 3", "0", "2", "button 40", "99"]) assert.ok(parseButton(bad).error, bad);
});

test("actions: friendly names, shortcuts, apps to open, and a refusal for the unknown", () => {
  assert.deepEqual(parseAction("stage manager").action, { kind: "system", name: "stageManager" });
  assert.deepEqual(parseAction("do mission control").action, { kind: "system", name: "missionControl" });
  assert.deepEqual(parseAction("the left desktop").action, { kind: "system", name: "desktopLeft" });
  assert.deepEqual(parseAction("go to the right space").action, { kind: "system", name: "desktopRight" });
  assert.deepEqual(parseAction("screenshot").action, { kind: "shortcut", keys: "cmd+shift+4" });
  assert.deepEqual(parseAction("command shift 3").action, { kind: "shortcut", keys: "cmd+shift+3" });
  assert.deepEqual(parseAction("summon orion").action, { kind: "orion", command: "summon" });
  for (const t of ["type to orion", "the text box", "open the text box", "orion text box", "typing box", "open the typing window"])
    assert.deepEqual(parseAction(t).action, { kind: "orion", command: "type" }, t);
  assert.deepEqual(parseAction("nothing").action, { kind: "passthrough" });
  assert.equal(parseAction("open spotify").app, "spotify");
  assert.deepEqual(parseAction(""), { ask: "action" });
  assert.ok(parseAction("make coffee").error);
  assert.equal(parseKeys("ctrl+option+left"), "ctrl+opt+left");
  assert.equal(parseKeys("shift"), null);
  assert.equal(parseKeys("banana+4"), null);
});

test("apps: the built-in table, a bundle id as written, and no lookup unless needed", () => {
  assert.deepEqual(resolveApp("Minecraft"), { bundleId: "com.mojang.minecraftlauncher", name: "Minecraft" });
  assert.deepEqual(resolveApp("the minecraft launcher app"), { bundleId: "com.mojang.minecraftlauncher", name: "Minecraft" });
  assert.equal(resolveApp("com.example.Thing").bundleId, "com.example.Thing");
  let looked = 0;
  assert.equal(resolveApp("safari", { lookup: () => { looked += 1; return null; } }).bundleId, "com.apple.Safari");
  assert.equal(looked, 0);
  assert.equal(resolveApp("Obscure Tool", { lookup: (n) => (n === "Obscure Tool" ? "com.obscure.tool" : null) }).bundleId, "com.obscure.tool");
  assert.ok(resolveApp("zzz nothing", { lookup: () => null }).error);
  assert.ok(resolveApp("x'; rm -rf /").error);
});

test("contract: actions and bindings are validated strictly", () => {
  assert.ok(validAction({ kind: "system", name: "stageManager" }));
  assert.ok(!validAction({ kind: "system", name: "rebootMac" }));
  assert.ok(!validAction({ kind: "shortcut", keys: "cmd+" }));
  assert.ok(!validAction({ kind: "openApp", bundleId: "not a bundle" }));
  assert.ok(!validAction({ kind: "exec", command: "rm" }));
  assert.doesNotThrow(() => assertBindings(emptyBindings()));
  assert.throws(() => assertBindings({ ...emptyBindings(), default: { 1: { kind: "passthrough" } } }));
  assert.throws(() => assertBindings({ ...emptyBindings(), passthroughApps: ["a b"] }));
});

test("set: writes the contract shape, per app and default, and keeps the app's other fields", () => {
  const s = sandbox({ bindings: { ...emptyBindings(), futureField: { keep: true }, default: { 4: { kind: "system", name: "launchpad" } } } });
  const a = s.run("set", "front side", "stage manager");
  assert.equal(a.code, 0); assert.match(a.out.say, /front side button now does Stage Manager/);
  const b = s.run("set", "back", "screenshot", "--app", "Safari");
  assert.match(b.out.say, /in Safari/);
  const written = s.bindingsNow();
  assert.deepEqual(written.default, { 4: { kind: "system", name: "stageManager" } });
  assert.deepEqual(written.apps, { "com.apple.Safari": { 3: { kind: "shortcut", keys: "cmd+shift+4" } } });
  assert.deepEqual(written.futureField, { keep: true });
  assert.deepEqual(readdirSync(join(s.dir, "mouse")).filter((f) => f.endsWith(".tmp") || f.endsWith(".lock")), []);
});

test("set: a missing button or action asks and writes nothing; a button this mouse lacks is refused", () => {
  const s = sandbox();
  const noButton = s.run("set", "side button", "stage manager");
  assert.deepEqual([noButton.code, noButton.out.asking, noButton.out.ask], [0, true, "button"]);
  assert.match(noButton.out.say, /front or the back/);
  const noAction = s.run("set", "back", "");
  assert.deepEqual([noAction.out.asking, noAction.out.ask, noAction.out.button], [true, "action", 3]);
  assert.equal(s.run("set", "button 11", "stage manager").code, 1);
  assert.equal(s.run("set", "left", "stage manager").code, 1);
  assert.equal(s.run("set", "back", "reformat the disk").code, 1);
  assert.throws(() => readFileSync(join(s.dir, "mouse", "bindings.json")));
});

test("learn opens the popup with a learn-open line", () => {
  const s = sandbox();
  const r = s.run("learn");
  assert.equal(r.out.ok, true);
  assert.match(r.out.say, /press the button/);
  const rows = readFileSync(join(s.dir, "outreach.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual([rows[0].kind, rows[0].event], ["mouse", "learn-open"]);
});

test("clear, passthrough, games and setup", () => {
  const s = sandbox();
  s.run("set", "back", "mission control");
  assert.equal(s.run("clear", "back").out.cleared, true);
  assert.match(s.run("clear", "back").out.say, /wasn't set to anything/);
  assert.match(s.run("passthrough", "add", "minecraft").out.say, /won't do anything in Minecraft/);
  assert.match(s.run("passthrough", "add", "Minecraft").out.say, /already/);
  assert.deepEqual(s.bindingsNow().passthroughApps, ["com.mojang.minecraftlauncher"]);
  assert.match(s.run("passthrough", "remove", "com.mojang.minecraftlauncher").out.say, /work in Minecraft again/);
  assert.deepEqual(s.bindingsNow().passthroughApps, []);
  s.run("games", "off"); assert.equal(s.bindingsNow().autoPassthroughGames, false);
  assert.equal(s.run("games", "maybe").code, 1);
  const fresh = sandbox();
  const popup = fresh.run("setup");
  assert.equal(popup.out.say, "Okay, let me help. Tell me what you want the buttons to do, or set them here:");
  const again = sandbox().run("setup", "--again");
  assert.equal(again.out.say, "Here it is.");
  assert.equal(again.out.ok, true);
  const rows = readFileSync(join(fresh.dir, "outreach.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["at", "event", "kind"]);
  assert.deepEqual([rows[0].kind, rows[0].event], ["mouse", "setup-open"]);
  assert.ok(Number.isFinite(Date.parse(rows[0].at)));
  const plan = fresh.run("setup", "--suggest");
  assert.equal(plan.out.asking, true);
  assert.match(plan.out.say, /back side button.*front side button.*button 6/s);
  assert.match(plan.out.say, /front side button on Stage Manager/);
  assert.throws(() => readFileSync(join(fresh.dir, "mouse", "bindings.json")));
  fresh.run("setup", "--apply");
  assert.deepEqual(fresh.bindingsNow().default, { 3: { kind: "system", name: "missionControl" }, 4: { kind: "system", name: "stageManager" } });
  assert.match(fresh.run("setup", "--apply").out.say, /already set/);
});

test("status: no mouse yet, and a full readout", () => {
  const none = sandbox({ devices: null });
  assert.match(none.run("status").out.say, /haven't seen a mouse/);
  const s = sandbox();
  s.run("set", "front", "stage manager"); s.run("set", "back", "left desktop", "--app", "com.apple.Safari"); s.run("passthrough", "add", "minecraft");
  const say = s.run("status").out.say;
  assert.match(say, /Razer Basilisk V3 \(USB, connected\)/);
  assert.match(say, /front side button: Stage Manager/);
  assert.match(say, /In Safari: back side button: the left desktop/);
  assert.match(say, /Left alone in: Minecraft/);
});

test("a corrupt bindings file is refused, not overwritten; bad usage exits 2", () => {
  const s = sandbox({ bindings: "{not json" });
  const r = s.run("set", "back", "mission control");
  assert.equal(r.code, 1);
  assert.equal(readFileSync(join(s.dir, "mouse", "bindings.json"), "utf8"), "{not json");
  assert.equal(spawnSync(process.execPath, [bin, "wat"], { encoding: "utf8" }).status, 2);
  const st = s.run("status");
  assert.equal(st.code, 1); assert.match(st.out.say, /unreadable/);
});

test("shortcuts on|off flips enabled only, validated; games also sets auto-pause; bindings validate the new fields", () => {
  const s = sandbox();
  assert.equal(emptyBindings().autoPauseInGames, true);
  assert.equal(emptyBindings().toggleShortcut, "ctrl+opt+m");
  assert.match(s.run("shortcuts", "off").out.say, /off/i);
  assert.equal(s.bindingsNow().enabled, false);
  assert.equal(s.bindingsNow().reverseWheel, "always");
  assert.match(s.run("status").out.say, /switched off/i);
  assert.match(s.run("shortcuts", "on").out.say, /on/i);
  assert.equal(s.bindingsNow().enabled, true);
  assert.equal(s.run("shortcuts", "maybe").code, 1);
  assert.equal(s.run("shortcuts").code, 2);
  s.run("games", "off");
  assert.equal(s.bindingsNow().autoPauseInGames, false);
  s.run("games", "on");
  assert.equal(s.bindingsNow().autoPauseInGames, true);
  assert.throws(() => assertBindings({ ...emptyBindings(), autoPauseInGames: "yes" }));
  assert.throws(() => assertBindings({ ...emptyBindings(), toggleShortcut: "m" }));
  assert.doesNotThrow(() => assertBindings({ ...emptyBindings(), toggleShortcut: "ctrl+opt+n" }));
});

test("wheel: games | always | never writes reverseWheel, validated, and status says it", () => {
  const s = sandbox();
  assert.equal(emptyBindings().reverseWheel, "always");
  assert.match(s.run("wheel", "always").out.say, /everywhere/i);
  assert.equal(s.bindingsNow().reverseWheel, "always");
  assert.match(s.run("wheel", "never").out.say, /as macOS has it/i);
  assert.equal(s.bindingsNow().reverseWheel, "never");
  assert.match(s.run("wheel", "games").out.say, /game/i);
  assert.equal(s.bindingsNow().reverseWheel, "games");
  assert.equal(s.run("wheel", "sideways").code, 1);
  assert.equal(s.run("wheel").code, 2);
  assert.equal(s.bindingsNow().reverseWheel, "games");
  s.run("wheel", "always");
  assert.match(s.run("status").out.say, /wheel/i);
  assert.throws(() => assertBindings({ ...emptyBindings(), reverseWheel: "sideways" }));
  assert.doesNotThrow(() => assertBindings({ ...emptyBindings(), reverseWheel: "never" }));
});

test("wheel: other bindings survive a wheel change, and a fresh bindings file defaults to always", () => {
  const s = sandbox({ bindings: { version: 1, enabled: true, default: { 3: { kind: "system", name: "stageManager" } }, apps: {}, passthroughApps: [], autoPassthroughGames: true } });
  s.run("wheel", "always");
  const b = s.bindingsNow();
  assert.equal(b.reverseWheel, "always");
  assert.deepEqual(b.default["3"], { kind: "system", name: "stageManager" });
});

test("top button: a mouse button its own memory turned into F13 is button 113, by word, key name or number", () => {
  for (const [said, n] of [["top button", 113], ["the top one", 113], ["top", 113], ["sensitivity button", 113], ["dpi button", 113], ["f13", 113], ["F13 button", 113], ["f14", 114], ["f20", 120], ["113", 113], ["120", 120]]) {
    assert.deepEqual(parseButton(said), { n }, said);
  }
  assert.deepEqual(parseButton("front"), { n: 4 });
  for (const bad of ["112", "121", "f12", "f21", "100"]) assert.ok(parseButton(bad).error, bad);
  assert.equal(buttonLabel(113), "top button");
  assert.equal(buttonLabel(114), "F14 key button");
  assert.equal(buttonLabel(5), "button 6");
});

test("top button: bindings accept 113 through 120 and nothing between 32 and 112", () => {
  assert.doesNotThrow(() => assertBindings({ ...emptyBindings(), default: { 113: { kind: "orion", command: "type" } } }));
  assert.doesNotThrow(() => assertBindings({ ...emptyBindings(), apps: { "com.apple.Safari": { 120: { kind: "passthrough" } } } }));
  for (const k of [100, 112, 121, 999]) assert.throws(() => assertBindings({ ...emptyBindings(), default: { [k]: { kind: "passthrough" } } }), String(k));
});

test("top button: set and status through the CLI", () => {
  const devices = { version: 1, devices: [{ id: "5426:185", name: "Razer Basilisk V3 X HyperSpeed", transport: "USB", buttonCount: 6, extraButtons: [3, 4, 5, 113], connected: true, setupState: "configured" }] };
  const s = sandbox({ devices });
  const r = s.run("set", "top button", "mission control");
  assert.equal(r.code, 0); assert.match(r.out.say, /top button now does Mission Control/);
  assert.deepEqual(s.bindingsNow().default, { 113: { kind: "system", name: "missionControl" } });
  assert.match(s.run("status").out.say, /top button/);
  const lacking = sandbox({ devices: { ...devices, devices: [{ ...devices.devices[0], extraButtons: [3, 4] }] } });
  assert.equal(lacking.run("set", "f13", "stage manager").code, 1);
});
