// orion-apps (2026-11-03): the policy (what counts as unused, what is never closed, fuzzy names), the escalation (quit, SIGTERM the tree, SIGKILL,
// a document app with a save prompt left alone), the four commands and their replies, and the parsers for lsappinfo, pmset and ps.
// All against a stub process table: nothing here touches a real app or sends a signal.
import test from "node:test";
import assert from "node:assert/strict";
import { closeApp } from "../scripts/lib/apps/escalate.mjs";
import { keptReason, matchApps } from "../scripts/lib/apps/policy.mjs";
import { hideApp, listApps, quitNamed, quitUnused } from "../scripts/lib/apps/run.mjs";
import { audiblePids, parseLsappinfo, parsePs, treeOf } from "../scripts/lib/apps/live.mjs";

const app = (o) => ({ name: "App", bundleId: "com.x.app", pid: 100, path: "/Applications/App.app", kind: "regular", frontmost: false, windows: 0, onscreen: 0, rank: null, audible: false, document: false, ...o });

/** procs: [{ pid, name, quit: "exit"|"ignore", term: "exit"|"ignore", helperOf?: pid }] ; every proc is alive until it exits or is signalled. */
function stub(apps, procs) {
  const alive = new Set(procs.map((p) => p.pid));
  const log = [];
  const by = (pid) => procs.find((p) => p.pid === pid);
  return {
    log,
    snapshot: () => apps.filter((a) => alive.has(a.pid)),
    alive: (pid) => alive.has(pid),
    tree: (a) => procs.filter((p) => alive.has(p.pid) && (p.pid === a.pid || p.helperOf === a.pid)).map((p) => ({ pid: p.pid, name: p.name })),
    quit: (a) => { log.push(["quit", a.pid]); if (by(a.pid).quit === "exit") alive.delete(a.pid); },
    hide: () => true,
    signal: (pid, sig) => { log.push([sig, pid]); const p = by(pid); if (p && (sig === "SIGKILL" || (sig === "SIGTERM" && p.term === "exit"))) alive.delete(pid); },
    windowCount: (a) => a.windows,
    ownsTree: () => false,
    sleep: async () => {},
  };
}

test("escalation: exits after the normal quit, nothing is signalled", async () => {
  const s = stub([app({ pid: 1 })], [{ pid: 1, name: "App", quit: "exit" }]);
  assert.deepEqual(await closeApp(app({ pid: 1 }), s), { name: "App", state: "closed", how: "quit", helpers: [] });
  assert.deepEqual(s.log, [["quit", 1]]);
});

test("escalation: ignores the quit, SIGTERM takes the app and its helpers", async () => {
  const procs = [{ pid: 1, name: "Epic", quit: "ignore", term: "exit" }, { pid: 2, name: "EpicWebHelper", helperOf: 1, quit: "ignore", term: "exit" }, { pid: 3, name: "crashpad_handler", helperOf: 1, quit: "ignore", term: "exit" }];
  const s = stub([app({ pid: 1, name: "Epic" })], procs);
  const r = await closeApp(app({ pid: 1, name: "Epic" }), s);
  assert.equal(r.state, "closed"); assert.equal(r.how, "term"); assert.deepEqual(r.helpers, ["EpicWebHelper", "crashpad_handler"]);
  assert.deepEqual(s.log.map(([k]) => k), ["quit", "SIGTERM", "SIGTERM", "SIGTERM"]);
});

test("escalation: ignores SIGTERM too, SIGKILL finishes it", async () => {
  const procs = [{ pid: 1, name: "Steam", quit: "ignore", term: "ignore" }, { pid: 2, name: "Steam Helper", helperOf: 1, quit: "ignore", term: "ignore" }];
  const s = stub([app({ pid: 1, name: "Steam" })], procs);
  const r = await closeApp(app({ pid: 1, name: "Steam" }), s);
  assert.equal(r.state, "closed"); assert.equal(r.how, "kill"); assert.deepEqual(r.helpers, ["Steam Helper"]);
  assert.equal(s.log.filter(([k]) => k === "SIGKILL").length, 2);
});

test("escalation: the app quits but a helper lingers, the helper alone is ended", async () => {
  const procs = [{ pid: 1, name: "Discord", quit: "exit", term: "exit" }, { pid: 2, name: "Discord Helper", helperOf: 1, quit: "ignore", term: "exit" }];
  const s = stub([app({ pid: 1, name: "Discord" })], procs);
  const r = await closeApp(app({ pid: 1, name: "Discord" }), s);
  assert.deepEqual([r.state, r.how, r.helpers], ["closed", "term", ["Discord Helper"]]);
  assert.deepEqual(s.log, [["quit", 1], ["SIGTERM", 2]]);
});

test("escalation: a document app with a window and a save prompt is left alone, never signalled", async () => {
  const word = app({ pid: 1, name: "Word", document: true, windows: 1 });
  const s = stub([word], [{ pid: 1, name: "Word", quit: "ignore", term: "exit" }]);
  assert.equal((await closeApp(word, s)).state, "asking_to_save");
  assert.deepEqual(s.log, [["quit", 1]]);
});

test("escalation: a document app with no window is not showing a prompt, so it escalates; an app already gone is reported so", async () => {
  const pages = app({ pid: 1, name: "Pages", document: true, windows: 0 });
  assert.equal((await closeApp(pages, stub([pages], [{ pid: 1, name: "Pages", quit: "ignore", term: "exit" }]))).how, "term");
  assert.equal((await closeApp(app({ pid: 9 }), stub([], []))).state, "not_running");
});

test("escalation: a tree holding whoever runs this script is not signalled", async () => {
  const s = { ...stub([app({ pid: 1 })], [{ pid: 1, name: "Terminal", quit: "ignore", term: "exit" }]), ownsTree: () => true };
  assert.equal((await closeApp(app({ pid: 1 }), s)).state, "left_alone");
  assert.deepEqual(s.log, [["quit", 1]]);
});

test("policy: never Finder, ORION, OrionLink or the model server, even when named", async () => {
  const names = ["Finder", "Orion", "OrionLink", "Ollama"];
  const apps = names.map((name, i) => app({ name, pid: i + 1, bundleId: `com.x.${name}` }));
  const s = stub(apps, apps.map((a) => ({ pid: a.pid, name: a.name, quit: "exit" })));
  const r = await quitNamed(s, ["finder", "orion", "orionlink", "ollama"]);
  assert.deepEqual(s.log, []);
  assert.match(r.say, /stay open/);
});

test("policy: kept reasons, in order", () => {
  assert.match(keptReason(app({ frontmost: true })), /in it right now/);
  assert.match(keptReason(app({ name: "Ghostty", bundleId: "com.mitchellh.ghostty" })), /terminal/);
  assert.match(keptReason(app({ name: "Atlas", bundleId: "com.nick.atlas" })), /recording/);
  assert.match(keptReason(app({ name: "System Settings", bundleId: "com.apple.systempreferences" })), /mid-change/);
  assert.match(keptReason(app({ name: "Spotify", audible: true })), /audio/);
  assert.match(keptReason(app({ name: "Chrome", onscreen: 1, windows: 1, rank: 1 })), /recent/);
  assert.match(keptReason(app({ name: "Notes" }), { keep: ["notes"] }), /keep list/);
  assert.equal(keptReason(app({ name: "Chrome", onscreen: 1, windows: 1, rank: 4 })), null);
  assert.equal(keptReason(app({ name: "Pages", windows: 2, onscreen: 0 })), null);
});

test("policy: a background launcher with no window is unused; a menu-bar utility is not", () => {
  assert.equal(keptReason(app({ name: "Epic Games Launcher", kind: "accessory" })), null);
  assert.equal(keptReason(app({ name: "Discord", kind: "accessory", bundleId: "com.hnc.Discord" })), null);
  assert.match(keptReason(app({ name: "1Password", kind: "accessory", bundleId: "com.1password.1password" })), /standing job/);
  assert.match(keptReason(app({ name: "Spotify", kind: "accessory", audible: true })), /audio/);
});

test("names: fuzzy and spoken", () => {
  const apps = [app({ name: "TeamViewer", pid: 1 }), app({ name: "Epic Games Launcher", pid: 2 }), app({ name: "Google Chrome", pid: 3 }), app({ name: "Discord", pid: 4 })];
  assert.deepEqual(matchApps("team view", apps).map((a) => a.name), ["TeamViewer"]);
  assert.deepEqual(matchApps("epic games", apps).map((a) => a.name), ["Epic Games Launcher"]);
  assert.deepEqual(matchApps("chrome", apps).map((a) => a.name), ["Google Chrome"]);
  assert.deepEqual(matchApps("x", apps), []);
});

test("quit: closes named apps (even a terminal), says what was closed, forced, helpers, and what isn't open", async () => {
  const apps = [app({ name: "Epic Games Launcher", pid: 1, kind: "accessory" }), app({ name: "TeamViewer", pid: 2 })];
  const s = stub(apps, [{ pid: 1, name: "Epic", quit: "ignore", term: "exit" }, { pid: 5, name: "EpicWebHelper", helperOf: 1, quit: "ignore", term: "exit" }, { pid: 2, name: "TeamViewer", quit: "exit" }]);
  const r = await quitNamed(s, ["epic games", "team view", "spotify"]);
  assert.deepEqual(r.closed, ["Epic Games Launcher", "TeamViewer"]);
  assert.match(r.say, /Closed Epic Games Launcher \(it ignored a normal quit, so I ended it, helper EpicWebHelper included\) and TeamViewer\./);
  assert.match(r.say, /spotify isn't open/);
});

test("quit: a document app asking to save is named, not killed", async () => {
  const word = app({ name: "Microsoft Word", pid: 1, document: true, windows: 1 });
  const r = await quitNamed(stub([word], [{ pid: 1, name: "Word", quit: "ignore", term: "exit" }]), ["word"]);
  assert.equal(r.say, "Microsoft Word is asking to save, so I left it open for you.");
  assert.deepEqual(r.closed, []);
});

test("quit-unused: closes the unused, keeps the rest with reasons, honors --keep", async () => {
  const apps = [
    app({ name: "Safari", pid: 1, frontmost: true, onscreen: 1, windows: 1, rank: 0 }),
    app({ name: "Steam", pid: 2, windows: 0 }),
    app({ name: "Epic Games Launcher", pid: 3, kind: "accessory" }),
    app({ name: "Spotify", pid: 4, audible: true }),
    app({ name: "Terminal", pid: 5, bundleId: "com.apple.Terminal" }),
    app({ name: "Maps", pid: 6, windows: 1 }),
  ];
  const procs = apps.map((a) => ({ pid: a.pid, name: a.name, quit: "exit", term: "exit" }));
  const s = stub(apps, procs);
  const r = await quitUnused(s, { keep: ["maps"] });
  assert.deepEqual(r.closed, ["Steam", "Epic Games Launcher"]);
  assert.match(r.say, /^Closed Steam and Epic Games Launcher\./);
  assert.match(r.say, /Kept Safari \(you're in it right now\)/);
  assert.match(r.say, /Spotify \(playing audio\)/);
  assert.match(r.say, /Maps \(on your keep list\)/);
  assert.match(r.say, /window stack/);
  assert.deepEqual(s.log.map(([k]) => k), ["quit", "quit"]);
});

test("quit-unused --dry-run signals nothing and lists what it would close; nothing unused says so", async () => {
  const apps = [app({ name: "Steam", pid: 2 }), app({ name: "Safari", pid: 1, frontmost: true })];
  const s = stub(apps, apps.map((a) => ({ pid: a.pid, name: a.name, quit: "exit" })));
  const r = await quitUnused(s, { dryRun: true });
  assert.match(r.say, /^I would close Steam \(no window open\)/);
  assert.deepEqual(s.log, []);
  const none = await quitUnused(stub([apps[1]], [{ pid: 1, name: "Safari", quit: "exit" }]), {});
  assert.match(none.say, /Nothing looked unused/);
});

test("list and hide", () => {
  const apps = [app({ name: "Safari", pid: 1, frontmost: true, windows: 2, onscreen: 2, rank: 0 }), app({ name: "Spotify", pid: 2, audible: true, windows: 1 }), app({ name: "Epic Games Launcher", pid: 3, kind: "accessory" })];
  const s = stub(apps, apps.map((a) => ({ pid: a.pid, name: a.name })));
  const l = listApps(s);
  assert.match(l.say, /2 apps open, you're in Safari: Safari and Spotify \(playing audio\)\. Running in the background or menu bar: Epic Games Launcher\./);
  assert.equal(l.apps[0].lastActive, "now");
  assert.equal(hideApp(s, "spotify").ok, true);
  assert.equal(hideApp(s, "finder").ok, false);
  assert.equal(hideApp(s, "nothing here").ok, false);
});

test("parsers: lsappinfo, pmset audio, ps, and an app's tree stays inside its own bundle, ids and children", () => {
  const ls = parseLsappinfo(` 1) "Spotify" ASN:0x0-0x1:\n    bundleID="com.spotify.client"\n    bundle path="/Applications/Spotify.app"\n    pid = 50 type="Foreground" flavor=3\n 2) "Spotify Helper" ASN:0x0-0x2:\n    bundleID="com.spotify.client.helper"\n    bundle path="/Applications/Spotify.app/Contents/Frameworks/H.app"\n    pid = 51 type="BackgroundOnly" flavor=3\n`);
  assert.deepEqual(ls.map((e) => [e.name, e.pid, e.type]), [["Spotify", 50, "Foreground"], ["Spotify Helper", 51, "BackgroundOnly"]]);
  const pm = audiblePids('   pid 444(coreaudiod): [0x1] 00:10:28 PreventUserIdleSystemSleep named: "x"\n\tCreated for PID: 50. \n\tResources: audio-out BuiltInSpeakerDevice \n   pid 444(coreaudiod): [0x2] 00:23:01 PreventUserIdleSystemSleep named: "y"\n\tCreated for PID: 77. \n\tResources: audio-in AOP \n');
  assert.deepEqual([...pm], [50]);
  const ps = parsePs("   50     1 /Applications/Spotify.app/Contents/MacOS/Spotify\n   51    50 /Applications/Spotify.app/Contents/Frameworks/H.app/Contents/MacOS/H\n   60     1 /Applications/Spotify.app/Contents/Frameworks/Orphan\n   70    50 /usr/bin/ssh\n   80     1 /Applications/Other.app/Contents/MacOS/Other\n");
  const tree = treeOf({ pid: 50, bundleId: "com.spotify.client", path: "/Applications/Spotify.app" }, ps, ls, new Set([999]));
  assert.deepEqual(tree.map((p) => p.pid).sort(), [50, 51, 60]);   // the /usr/bin child and the other app are untouched
  assert.deepEqual(treeOf({ pid: 50, bundleId: "com.spotify.client", path: "/Applications/Spotify.app" }, ps, ls, new Set([51])).map((p) => p.pid).sort(), [50, 60]);
});
