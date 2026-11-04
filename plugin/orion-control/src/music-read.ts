/*
 Music turns (w18 music, 2026-11-03): "play my music", "pause the music", "skip", "play lofi on spotify". Pure: apps-read.ts calls this, apps-chat.ts runs
 `orion-apps music ...`, which opens or resumes Spotify (else Music) and says Playing only once the player reports it.

 Why: "play my music" with no player open went to the local model's media_play_pause, which only toggles an open player ("No supported media player is
 running"), and Nick got "I didn't actually do that". A deterministic route opens the player itself.

 Not music: "skip class", "pause the timer", "play minecraft", "play some games", "how do i play music on my phone", "stop the alarm".
*/
export type MusicTurn = { kind: "music"; action: "play" | "pause" | "skip" | "previous"; query?: string; player?: "spotify" | "music" };

const LEAD = String.raw`(?:(?:can you|can u|could you|will you|pls|please|hey|ok|okay|orion|yo|just|also|and|so|now|go ahead and)[,\s]+)*`;
const TAIL = String.raw`(?:\s+(?:pls|please|plz|rn|real quick|right now|now|for me|again|lol|thanks))*`;
const MUSIC = String.raw`(?:music|msuic|musci|muisc|musik|tunes|songs?)`;
const PLAYER = String.raw`(?:spotify|spotfy|spotifiy|apple music|the music app|music app)`;
const ASK = /^(?:how|what|why|when|where|who|which|can't|cant|cannot|is|are|does|do|did|should|would|could|will|am i|have i)\b|\?\s*$/;
const NOT_A_SONG = /\b(?:games?|gaming|minecraft|fortnite|valorant|roblox|football|soccer|tennis|basketball|golf|chess|cards|poker|ball|sports?|dog|outside|later|tonight|around|it|that|this|with|along|me|him|her|them|catch|dumb|hooky|role|time|tomorrow|today)\b/;

const asPlayer = (s: string | undefined): "spotify" | "music" | undefined => (s ? (/^spot/.test(s) ? "spotify" : "music") : undefined);
const clean = (q: string) => q.replace(/^(?:some|my|a bit of)\s+/, "").replace(/\s+playlist$/, "").trim();
const okQuery = (q: string) => q.length >= 2 && q.split(" ").length <= 4 && !NOT_A_SONG.test(q);

const GENERIC = new RegExp(String.raw`^${LEAD}(?:(?:play|put on|start|resume|unpause|turn on|put)\s+(?:some\s+|my\s+|the\s+|a bit of\s+)?(?:${MUSIC}|${PLAYER})|(?:put|turn)\s+(?:some\s+|my\s+|the\s+)?${MUSIC}\s+on)${TAIL}$`);
const ON_PLAYER = new RegExp(String.raw`^${LEAD}play\s+(.+?)\s+on\s+(${PLAYER})${TAIL}$`);
const PLAYLIST = new RegExp(String.raw`^${LEAD}play\s+(?:my|the)\s+(.+?)\s+playlist${TAIL}$`);
const SOME = new RegExp(String.raw`^${LEAD}(?:play|put on)\s+some\s+(.+?)${TAIL}$`);
const PAUSE = new RegExp(String.raw`^${LEAD}(?:pause|stop|turn off|shut off|kill)\s+(?:playing\s+|the\s+|my\s+|some\s+)*(?:${MUSIC}|${PLAYER}|the song)${TAIL}$`);
const SKIP = new RegExp(String.raw`^${LEAD}(?:skip(?:\s+(?:this|the|that))?(?:\s+(?:song|track|one))?|(?:next|skip to the next|go to the next)\s+(?:song|track|one))${TAIL}$`);
const PREVIOUS = new RegExp(String.raw`^${LEAD}(?:play\s+(?:the\s+)?)?(?:previous|prev|last|go back (?:a|one|to the last|to the previous)?)\s*(?:song|track)${TAIL}$`);

export function readMusicTurn(m: string): MusicTurn | null {
  if (ASK.test(m)) return null;
  if (PAUSE.test(m)) return { kind: "music", action: "pause" };
  if (PREVIOUS.test(m)) return { kind: "music", action: "previous" };
  if (SKIP.test(m) && !/^(?:.*\s)?skip\s+(?:the\s+)?(?:class|gym|workout|breakfast|lunch|dinner|meal|day|meeting|lecture|school|work)\b/.test(m)) return { kind: "music", action: "skip" };
  if (GENERIC.test(m)) return { kind: "music", action: "play" };
  const on = ON_PLAYER.exec(m);
  if (on) { const q = clean(on[1] ?? ""); if (okQuery(q)) return { kind: "music", action: "play", query: q, player: asPlayer(on[2]) }; }
  const list = PLAYLIST.exec(m);
  if (list) { const q = clean(list[1] ?? ""); if (okQuery(q)) return { kind: "music", action: "play", query: q }; }
  const some = SOME.exec(m);
  if (some) { const q = clean(some[1] ?? ""); if (okQuery(q) && !new RegExp(`^${MUSIC}$`).test(q)) return { kind: "music", action: "play", query: q }; }
  return null;
}
