// What he is doing right now: the reader for activity.json / activity-history.jsonl (written by the Mac app, w19;
// contract in .builds/w19/COMMON.md). Everything here is total: a missing, stale or broken file is "no activity",
// never an exception and never a guess. Pure except for the two file readers.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const FRESH_MS = 90_000;           // the app rewrites at least every 15 s; six missed beats is stale
export const AWAY_IDLE_S = 300;           // no input for 5 min: he has stepped away, the game or video is just left open
const DAY_MS = 86_400_000;

const readText = (path) => { try { return readFileSync(path, "utf8"); } catch { return null; } };
const readJson = (path) => { const t = readText(path); if (t === null) return null; try { return JSON.parse(t); } catch { return null; } };

/** The snapshot when it is a version 1 record written within FRESH_MS of `now`; otherwise null. */
export function readActivity(dir, now = new Date()) {
  const a = readJson(join(dir, "activity.json"));
  if (!a || typeof a !== "object" || a.version !== 1 || !a.app?.name) return null;
  const age = new Date(now).getTime() - Date.parse(a.at);
  if (!(age >= -5_000 && age <= FRESH_MS)) return null;
  // Privacy: whatever an older writer left in the file, a URL never leaves this reader and a window title only for a game.
  const { url: _url, window: title, ...rest } = a;
  return { ...rest, window: a.category === "game" || a.game ? title ?? null : null };
}

/** App and site only: two sessions of "the same thing" share a key, so a repeat is a repeat. */
export const activityKey = (a) => (a ? `${a.app?.bundleId ?? a.app?.name}|${a.domain ?? ""}` : null);

/** game | video | social, when what he is doing is that and he is at the keys; null for work, chat, music, idle. */
export function distractionOf(a) {
  if (!a) return null;
  if (Number.isFinite(a.idleSeconds) && a.idleSeconds >= AWAY_IDLE_S) return null;
  if (a.category === "game" || a.game) return "game";
  if (a.siteCategory === "video") return "video";
  if (a.category === "social" || a.siteCategory === "social") return "social";
  return null;
}

const SITE_NAMES = { "youtube.com": "YouTube", "youtu.be": "YouTube", "netflix.com": "Netflix", "twitch.tv": "Twitch", "reddit.com": "Reddit", "instagram.com": "Instagram",
  "x.com": "X", "twitter.com": "X", "tiktok.com": "TikTok", "facebook.com": "Facebook", "github.com": "GitHub", "docs.google.com": "Google Docs", "amazon.co.uk": "Amazon", "amazon.com": "Amazon" };
const siteName = (domain) => { const d = String(domain ?? ""); const hit = Object.keys(SITE_NAMES).find((k) => d === k || d.endsWith(`.${k}`)); return hit ? SITE_NAMES[hit] : d; };

/** "playing Minecraft", "watching YouTube", "on Reddit", "in Xcode": the verb phrase for a sentence about him. */
export function activityPhrase(a) {
  if (!a) return null;
  if (a.game?.name) return `playing ${a.game.name}`;
  if (a.domain) return a.siteCategory === "video" ? `watching ${siteName(a.domain)}` : `on ${siteName(a.domain)}`;
  return `in ${a.app.name}`;
}

/** "I know you're in Minecraft": the same thing as a place, for a sentence that starts with "you're". */
export const activityPlace = (a) => (a?.game?.name ? `in ${a.game.name}` : a?.domain ? `${a.siteCategory === "video" ? "watching" : "on"} ${siteName(a.domain)}` : a ? `in ${a.app.name}` : null);

const minutesSince = (iso, now) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, Math.round((new Date(now).getTime() - t) / 60000)) : null; };

/** How long he has been on this app (or site): the game's own `since`, else back through the history while the key holds. */
export function sinceOf(a, history, now) {
  if (a?.game?.since) return a.game.since;
  const key = activityKey({ app: { bundleId: a?.app?.bundleId, name: a?.app?.name }, domain: a?.domain });
  const rows = (history ?? []).filter((r) => r?.at).sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  const last = rows.at(-1);
  if (!last || `${last.bundleId ?? a?.app?.name}|${last.domain ?? ""}` !== key) return null;
  return last.at;
}

/** "Right now: playing Minecraft for 40 min" (no duration under 2 min, and "away" when he has not touched the Mac in 5). */
export function nowLine(a, { history = [], now = new Date() } = {}) {
  if (!a) return null;
  const away = Number.isFinite(a.idleSeconds) && a.idleSeconds >= AWAY_IDLE_S;
  const mins = minutesSince(sinceOf(a, history, now), now);
  const span = mins !== null && mins >= 2 ? ` for ${mins >= 90 ? `${Math.round(mins / 6) / 10} h` : `${mins} min`}` : "";
  const focus = a.focus?.active && a.focus.task ? `; focus session on ${a.focus.task}` : "";
  return `Right now: ${away ? `away from the Mac (${a.app.name} open)` : `${activityPhrase(a)}${span}`}${focus}`;
}

/** The history rows, newest last, within `days`. */
export function readHistory(dir, now = new Date(), days = 7) {
  const t = new Date(now).getTime();
  return (readText(join(dir, "activity-history.jsonl")) ?? "").split("\n").flatMap((l) => {
    if (!l.trim()) return [];
    try { const r = JSON.parse(l); const at = Date.parse(r.at); return Number.isFinite(at) && t - at <= days * DAY_MS && at <= t + 60_000 ? [r] : []; } catch { return []; }
  });
}

const CAT_WORD = { game: "gaming", work: "working", study: "studying", chat: "chatting", media: "media", social: "social media", browser: "browsing", system: "system", other: "other apps" };
const NAME_OF = (r) => (r.domain ? siteName(r.domain) : String(r.bundleId ?? "an app").split(".").at(-1));

/**
 * Where the time went: per-row duration is the gap to the next row (capped at 30 min so a closed lid is not hours of Safari),
 * the last row runs to `now`. Totals by category, and the top three things (a domain, or an app).
 */
export function summarizeHistory(rows, { now = new Date(), since = null } = {}) {
  const end = new Date(now).getTime();
  const from = since ? new Date(since).getTime() : -Infinity;
  const sorted = rows.filter((r) => Date.parse(r.at) >= from).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const byCategory = {}; const byThing = {};
  sorted.forEach((r, i) => {
    const next = sorted[i + 1] ? Date.parse(sorted[i + 1].at) : end;
    const mins = Math.max(0, Math.min(30, (next - Date.parse(r.at)) / 60000));
    byCategory[r.category] = (byCategory[r.category] ?? 0) + mins;
    const name = NAME_OF(r); byThing[name] = (byThing[name] ?? 0) + mins;
  });
  const top = (m, n) => Object.entries(m).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, minutes: Math.round(v) }));
  return { categories: top(byCategory, 4).map((c) => ({ ...c, word: CAT_WORD[c.name] ?? c.name })), things: top(byThing, 3) };
}
