// orion-apps music: "play my music", "pause", "skip", "play gym mix on spotify". Spotify when it is installed or running, otherwise Music.
// Said only as true as the player confirms: "Playing" follows a read of `player state`, never the press of play (2026-11-03: "play my music" got
// "No supported media player is running" because the old tool only toggled a player that was already open; it never opened one).
// Pure over deps: { installed(app), running(app), launch(app), osa(script) -> stdout (throws on error), sleep(ms) }.
const PLAYERS = ["Spotify", "Music"];
const q = (s) => String(s ?? "").replace(/["\\]/g, "").replace(/\s+/g, " ").trim();
const asName = (key) => (/^spot/i.test(key ?? "") ? "Spotify" : /^(?:apple|music)/i.test(key ?? "") ? "Music" : undefined);

/** Which player to use. Named: that one. Otherwise Spotify if it is installed or running, else Music (always there). */
export function choosePlayer(deps, requested) {
  const named = asName(requested);
  if (named) return named;
  return deps.running("Spotify") || deps.installed("Spotify") ? "Spotify" : "Music";
}

const stateOf = (deps, app) => { try { return deps.osa(`tell application "${app}" to return player state as text`).trim().toLowerCase(); } catch { return "unknown"; } };
const trackOf = (deps, app) => { try { return deps.osa(`tell application "${app}" to return (name of current track) & " by " & (artist of current track)`).trim(); } catch { return ""; } };

async function untilPlaying(deps, app, tries = 6) {
  for (let i = 0; i < tries; i++) {
    if (stateOf(deps, app) === "playing") return true;
    await deps.sleep(500);
  }
  return false;
}

async function open(deps, app) {
  if (deps.running(app)) return;
  deps.launch(app);
  for (let i = 0; i < 20 && !deps.running(app); i++) await deps.sleep(500);
  await deps.sleep(1500);   // a cold player takes a moment before it answers scripts
}

/** The player a pause/skip means: the one that is playing, else one that is open, else none. */
function activePlayer(deps) {
  const open_ = PLAYERS.filter((a) => deps.running(a));
  return open_.find((a) => stateOf(deps, a) === "playing") ?? open_[0] ?? null;
}

const MUSIC_FIND = (name) => `tell application "Music"
try
play playlist "${name}"
return "ok"
end try
try
play (first playlist whose name contains "${name}")
return "ok"
end try
try
set r to search playlist 1 for "${name}"
if (count of r) > 0 then
play item 1 of r
return "ok"
end if
end try
return "none"
end tell`;

async function play(deps, { query, player }) {
  const app = choosePlayer(deps, player);
  if (asName(player) === "Spotify" && !deps.running("Spotify") && !deps.installed("Spotify")) return { ok: false, player: "Spotify", say: "Spotify isn't installed on this Mac." };
  const what = q(query);
  await open(deps, app);
  if (what && app === "Spotify") {
    deps.osa(`open location "spotify:search:${encodeURIComponent(what)}"`);
    return { ok: true, started: false, player: app, say: `I opened Spotify's search for "${what}". It won't let me start a search result from here, so tap play on the one you want.` };
  }
  if (what) {
    if (deps.osa(MUSIC_FIND(what)).trim() !== "ok") return { ok: false, player: app, say: `I couldn't find "${what}" in your Music library.` };
  } else deps.osa(`tell application "${app}" to play`);
  if (await untilPlaying(deps, app)) {
    const track = trackOf(deps, app);
    return { ok: true, started: true, player: app, track, say: what ? `Playing ${what} on ${app}.` : track ? `Playing ${track} on ${app}.` : `Playing ${app}.` };
  }
  return { ok: false, started: false, player: app, say: `I opened ${app} and pressed play, but nothing is playing yet. It may have nothing queued, so give me a playlist name and I'll try that.` };
}

async function pause(deps) {
  const app = activePlayer(deps);
  if (!app) return { ok: false, say: "Nothing is playing: no music app is open." };
  deps.osa(`tell application "${app}" to pause`);
  return stateOf(deps, app) === "playing" ? { ok: false, player: app, say: `I told ${app} to pause but it is still playing.` } : { ok: true, player: app, say: `Paused ${app}.` };
}

async function step(deps, direction) {
  const app = activePlayer(deps);
  if (!app) return { ok: false, say: "Nothing is playing: no music app is open." };
  deps.osa(`tell application "${app}" to ${direction === "skip" ? "next" : "previous"} track`);
  await deps.sleep(800);
  const track = trackOf(deps, app);
  return { ok: true, player: app, track, say: `${direction === "skip" ? "Skipped" : "Went back"}${track ? `. Now playing ${track}` : ""}.` };
}

/** action: play | pause | skip | previous. Never throws; a failure is one honest sentence. */
export async function runMusic(action, opts, deps) {
  try {
    if (action === "play") return await play(deps, opts ?? {});
    if (action === "pause") return await pause(deps);
    if (action === "skip" || action === "previous") return await step(deps, action);
    return { ok: false, error: "usage", say: "I didn't catch what to do with the music." };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e), say: `I couldn't control the music just now (${String(e?.message ?? e).slice(0, 120)}), so nothing changed.` };
  }
}
