// w18 music: "play my music" opens or resumes the player and says so only when it is really playing. A fake Mac: which apps are installed and
// running, a scripted player state, and an osascript recorder. Nothing here starts a real player.
import test from "node:test";
import assert from "node:assert/strict";
import { choosePlayer, runMusic } from "../scripts/lib/apps/music.mjs";

/** A world: { installed, running, state, track } per app; every osascript and launch is logged. */
function world({ installed = ["Spotify", "Music"], running = [], state = {}, track = {}, playsOnPlay = true, libraryHit = true } = {}) {
  const run = new Set(running), st = { ...state }, log = [];
  const appOf = (script) => /application "(\w+)"/.exec(script)?.[1];
  return {
    log,
    deps: {
      installed: (a) => installed.includes(a), running: (a) => run.has(a),
      launch: (a) => { log.push(`launch ${a}`); run.add(a); },
      sleep: async () => {},
      osa: (script) => {
        const app = appOf(script); log.push(script.replace(/\s+/g, " ").trim());
        if (/player state/.test(script)) return st[app] ?? "stopped";
        if (/current track/.test(script) && /name of/.test(script)) return track[app] ?? "";
        if (/\bplay\b/.test(script) && !/spotify:search/.test(script) && !/search playlist/.test(script) && !/play playlist/.test(script)) { if (playsOnPlay) st[app] = "playing"; return ""; }
        if (/play playlist|search playlist/.test(script)) { if (!libraryHit) return "none"; st[app] = "playing"; return "ok"; }
        if (/\bpause\b/.test(script)) { st[app] = "paused"; return ""; }
        if (/next track|previous track/.test(script)) return "";
        return "";
      },
    },
  };
}

test("choosePlayer: Spotify when it is installed or running, Music otherwise, a named one when asked", () => {
  assert.equal(choosePlayer({ installed: (a) => a === "Spotify", running: () => false }), "Spotify");
  assert.equal(choosePlayer({ installed: (a) => a === "Music", running: () => false }), "Music");
  assert.equal(choosePlayer({ installed: () => false, running: () => false }), "Music");
  assert.equal(choosePlayer({ installed: () => true, running: (a) => a === "Music" }, "spotify"), "Spotify");
  assert.equal(choosePlayer({ installed: () => true, running: () => false }, "music"), "Music");
});

test("play my music with nothing open launches Spotify, presses play, and says Playing only once it is playing (the 11-03 failure)", async () => {
  const w = world({ track: { Spotify: "Blinding Lights by The Weeknd" } });
  const r = await runMusic("play", {}, w.deps);
  assert.equal(r.ok, true); assert.equal(r.player, "Spotify");
  assert.match(r.say, /Playing Blinding Lights by The Weeknd on Spotify/);
  assert.ok(w.log[0] === "launch Spotify");
});

test("play with Spotify already running does not relaunch; it resumes", async () => {
  const w = world({ running: ["Spotify"], state: { Spotify: "paused" } });
  const r = await runMusic("play", {}, w.deps);
  assert.equal(r.ok, true); assert.ok(!w.log.includes("launch Spotify"));
  assert.match(r.say, /Playing Spotify|on Spotify/);
});

test("no Spotify installed: Music is used", async () => {
  const w = world({ installed: ["Music"] });
  const r = await runMusic("play", {}, w.deps);
  assert.equal(r.player, "Music"); assert.equal(r.ok, true);
});

test("a player that never starts is reported as not playing, never as playing", async () => {
  const w = world({ playsOnPlay: false });
  const r = await runMusic("play", {}, w.deps);
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.say, /^Playing/);
  assert.match(r.say, /nothing is playing yet/i);
});

test("play a playlist on Music finds it in the library; a miss says so", async () => {
  const hit = await runMusic("play", { query: "gym mix", player: "music" }, world({ libraryHit: true }).deps);
  assert.equal(hit.ok, true); assert.match(hit.say, /gym mix/i);
  const miss = await runMusic("play", { query: "gym mix", player: "music" }, world({ libraryHit: false }).deps);
  assert.equal(miss.ok, false); assert.match(miss.say, /couldn't find "gym mix"/);
});

test("play X on Spotify opens its search and is honest that it did not start playing; quotes cannot break the script", async () => {
  const w = world({ running: ["Spotify"] });
  const r = await runMusic("play", { query: 'lofi "beats"', player: "spotify" }, w.deps);
  assert.equal(r.ok, true); assert.equal(r.started, false);
  assert.match(r.say, /search/i); assert.doesNotMatch(r.say, /^Playing/);
  const open = w.log.find((l) => /spotify:search/.test(l));
  assert.ok(open && /spotify:search:lofi%20beats/.test(open), open);
});

test("pause pauses whichever player is playing, and says so only when it stopped", async () => {
  const w = world({ running: ["Spotify", "Music"], state: { Music: "playing", Spotify: "paused" } });
  const r = await runMusic("pause", {}, w.deps);
  assert.equal(r.player, "Music"); assert.match(r.say, /Paused Music/);
});

test("pause with no player open does not launch one", async () => {
  const w = world();
  const r = await runMusic("pause", {}, w.deps);
  assert.equal(r.ok, false); assert.match(r.say, /nothing.*playing|no music app/i);
  assert.ok(!w.log.some((l) => l.startsWith("launch")));
});

test("skip and previous name the track now playing", async () => {
  const w = world({ running: ["Spotify"], state: { Spotify: "playing" }, track: { Spotify: "Song B by Band" } });
  assert.match((await runMusic("skip", {}, w.deps)).say, /Skipped.*Song B by Band/);
  assert.match((await runMusic("previous", {}, w.deps)).say, /Song B by Band/);
  assert.ok(w.log.some((l) => /next track/.test(l)) && w.log.some((l) => /previous track/.test(l)));
});

test("a script error is one honest sentence", async () => {
  const w = world({ running: ["Spotify"] });
  const r = await runMusic("pause", {}, { ...w.deps, osa: () => { throw new Error("not authorised"); } });
  assert.equal(r.ok, false); assert.match(r.say, /couldn't/i);
});
