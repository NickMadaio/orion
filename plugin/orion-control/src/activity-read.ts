/*
 What he is doing, from activity.json / activity-history.jsonl (written by the Mac app, w19; contract in .builds/w19/COMMON.md).

 Nick, 2026-11-04: "when I'm just home and he's yelling at me to start my resume or get to the gym, and I'm literally playing MC...
 he can always have a sight into what I'm doing." The card carries one line ("Right now: playing Minecraft for 40 min") and
 "what am i doing" / "what have i been doing today" are answered from the files, never from the model. Every reader is total:
 a missing, stale or broken file is "can't see", never an exception and never a guess.
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const FRESH_MS = 90_000;
export const AWAY_IDLE_S = 300;
const DAY_MS = 86_400_000;

export type Activity = {
  version: 1; at: string; idleSeconds: number | null;
  app: { name: string; bundleId: string | null; pid: number };
  category: string; window: string | null; domain: string | null; siteCategory: string | null;
  game: { name: string; since: string } | null;
  focus: { active: boolean; task: string | null; allowedApps: string[]; allowedDomains: string[] } | null;
};
export type HistoryRow = { at: string; bundleId: string | null; category: string; domain: string | null };

const text = (path: string): string | null => { try { return readFileSync(path, "utf8"); } catch { return null; } };

/** activity.json when it is a version 1 record written within FRESH_MS of `now`. */
export function readActivity(dir: string, now: Date): Activity | null {
  const raw = text(join(dir, "activity.json"));
  if (raw === null) return null;
  let a: Activity;
  try { a = JSON.parse(raw) as Activity; } catch { return null; }
  if (!a || a.version !== 1 || !a.app?.name) return null;
  const age = now.getTime() - Date.parse(a.at);
  if (!(age >= -5_000 && age <= FRESH_MS)) return null;
  // Privacy: whatever an older writer left in the file, a URL never leaves this reader and a window title only for a game.
  const { url: _url, window: title, ...rest } = a as Activity & { url?: unknown };
  return { ...rest, window: a.category === "game" || a.game ? title ?? null : null };
}

export function readHistory(dir: string, now: Date, days = 7): HistoryRow[] {
  return (text(join(dir, "activity-history.jsonl")) ?? "").split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const r = JSON.parse(line) as HistoryRow; const at = Date.parse(r.at);
      return Number.isFinite(at) && now.getTime() - at <= days * DAY_MS && at <= now.getTime() + 60_000 ? [r] : [];
    } catch { return []; }
  });
}

const SITE_NAMES: Record<string, string> = { "youtube.com": "YouTube", "youtu.be": "YouTube", "netflix.com": "Netflix", "twitch.tv": "Twitch", "reddit.com": "Reddit",
  "instagram.com": "Instagram", "x.com": "X", "twitter.com": "X", "tiktok.com": "TikTok", "facebook.com": "Facebook", "github.com": "GitHub", "docs.google.com": "Google Docs",
  "amazon.co.uk": "Amazon", "amazon.com": "Amazon" };
const siteName = (domain: string): string => { const hit = Object.keys(SITE_NAMES).find((k) => domain === k || domain.endsWith(`.${k}`)); return hit ? SITE_NAMES[hit]! : domain; };

const away = (a: Activity) => typeof a.idleSeconds === "number" && a.idleSeconds >= AWAY_IDLE_S;

/** "playing Minecraft", "watching YouTube", "on Reddit", "in Xcode". */
export function phrase(a: Activity): string {
  if (a.game?.name) return `playing ${a.game.name}`;
  if (a.domain) return a.siteCategory === "video" ? `watching ${siteName(a.domain)}` : `on ${siteName(a.domain)}`;
  return `in ${a.app.name}`;
}

const span = (mins: number | null): string => (mins === null || mins < 2 ? "" : ` for ${fmtMinutes(mins)}`);
export const fmtMinutes = (mins: number): string => {
  const m = Math.round(mins);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};

/** How long on this app or site: the game's own `since`, else the latest history row while it is the same thing. */
export function minutesOn(a: Activity, history: HistoryRow[], now: Date): number | null {
  const since = a.game?.since ?? (() => {
    const last = [...history].sort((x, y) => Date.parse(x.at) - Date.parse(y.at)).at(-1);
    return last && (last.bundleId ?? a.app.name) === (a.app.bundleId ?? a.app.name) && (last.domain ?? "") === (a.domain ?? "") ? last.at : null;
  })();
  const t = since ? Date.parse(since) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 60000)) : null;
}

/** "Right now: playing Minecraft for 40 min". Null when nothing fresh is known. */
export function nowLine(a: Activity | null, history: HistoryRow[], now: Date): string | null {
  if (!a) return null;
  const focus = a.focus?.active && a.focus.task ? `; focus session on ${a.focus.task}` : "";
  if (away(a)) return `Right now: away from the Mac (${a.app.name} left open)${focus}`;
  return `Right now: ${phrase(a)}${span(minutesOn(a, history, now))}${focus}`;
}

const CAT_WORD: Record<string, string> = { game: "gaming", work: "working", study: "studying", chat: "chatting", media: "on media", social: "on social media", browser: "browsing", system: "on the system", other: "in other apps" };
const nameOf = (r: HistoryRow): string => (r.domain ? siteName(r.domain) : String(r.bundleId ?? "an app").split(".").at(-1)!);

export type Summary = { categories: Array<{ category: string; minutes: number }>; things: Array<{ name: string; minutes: number }> };
/** Per-row time is the gap to the next row, capped at 30 min (a closed lid is not hours of Safari); the last row runs to `now`. */
export function summarize(rows: HistoryRow[], now: Date, since: Date): Summary {
  const sorted = rows.filter((r) => Date.parse(r.at) >= since.getTime()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const byCat = new Map<string, number>(); const byThing = new Map<string, number>();
  sorted.forEach((r, i) => {
    const next = sorted[i + 1] ? Date.parse(sorted[i + 1]!.at) : now.getTime();
    const mins = Math.max(0, Math.min(30, (next - Date.parse(r.at)) / 60000));
    byCat.set(r.category, (byCat.get(r.category) ?? 0) + mins);
    byThing.set(nameOf(r), (byThing.get(nameOf(r)) ?? 0) + mins);
  });
  const top = <K extends string>(m: Map<string, number>, key: K, n: number) => [...m].filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ [key]: k, minutes: Math.round(v) }));
  return { categories: top(byCat, "category", 4) as Summary["categories"], things: top(byThing, "name", 3) as Summary["things"] };
}

/** The day turns at 4 AM, like the rest of ORION. */
export function dayStart(now: Date): Date { const d = new Date(now); d.setHours(4, 0, 0, 0); return d > now ? new Date(d.getTime() - DAY_MS) : d; }

// --- the questions ---------------------------------------------------------------------------------------------------

const clean = (m: string) => m.toLowerCase().replace(/[’]/g, "'").replace(/[?!.,]+/g, " ").replace(/\s+/g, " ").trim();
const LEAD = String.raw`(?:(?:hey|ok|okay|so|yo|um|orion|orien|quick question|pls|please|tell me|can you tell me|do you know|u know|wait|wait so)\s+)*`;
const TAIL = String.raw`(?:\s+(?:rn|right now|now|currently|atm|at the moment|lol|lmao|pls|please|orion|exactly|even|again))*`;
const WHAT = String.raw`(?:wh?at|wat|whats|what's)`;
const NOW_ASK = new RegExp(String.raw`^${LEAD}(?:${WHAT}(?:\s+(?:am|is)\s+(?:i|im))?\s*(?:am i|i am|im|i'm|i)\s+(?:doing|up to|on)|what app am i (?:in|on|using)|what game am i (?:playing|in|on)|what am i (?:playing|watching|looking at|using|on)|can you see what i'?m doing|(?:do you|u) see what i'?m doing|what do you see me doing|what can you see me doing|what'?s on my screen)${TAIL}$`);
const TODAY_ASK = new RegExp(String.raw`^${LEAD}(?:${WHAT}\s+(?:have|did|ve)\s+i\s+(?:been\s+)?(?:doing|up to|done|do)(?:\s+(?:today|so far|all day|this morning|this afternoon|this evening|tonight|lately|since (?:i woke up|morning)|today so far))?|where did my (?:time|day) go(?:\s+today)?|how (?:much )?(?:long )?(?:have i been|did i spend)(?:\s+\w+){0,6}?\s+(?:today|so far)|what have i been on(?:\s+today)?|what i been (?:doing|up to)(?:\s+today)?)${TAIL}$`);
const FUTURE = /\b(?:tomorrow|tmrw|tonight|later|next|this weekend|friday|saturday|sunday|monday|tuesday|wednesday|thursday|supposed|should|plan|gonna|going to|after|before)\b/;

export type ActivityAsk = "now" | "today";
export function asksActivity(message: string): ActivityAsk | null {
  const m = clean(message.replace(/^\(Continuing[^)]*\)\s*/i, ""));
  if (!m || FUTURE.test(m)) return null;
  if (TODAY_ASK.test(m)) return "today";
  if (NOW_ASK.test(m)) return "now";
  return null;
}

/** First person, short enough to be spoken. */
export function nowReply(a: Activity | null, history: HistoryRow[], now: Date): string {
  if (!a) return "I can't see what you're on right now. The Mac hasn't checked in with me in the last minute or so.";
  const focus = a.focus?.active && a.focus.task ? ` You have a focus session on ${a.focus.task}.` : "";
  if (away(a)) return `You haven't touched the Mac for ${fmtMinutes(Math.round((a.idleSeconds ?? 0) / 60))}. ${a.app.name} is still open.${focus}`;
  return `You're ${phrase(a)}${span(minutesOn(a, history, now))}.${focus}`;
}

export function todayReply(rows: HistoryRow[], now: Date): string {
  const s = summarize(rows, now, dayStart(now));
  if (!s.categories.length) return "I don't have anything logged for today yet.";
  const cats = s.categories.slice(0, 3).map((c) => `${fmtMinutes(c.minutes)} ${CAT_WORD[c.category] ?? c.category}`).join(", ");
  const things = s.things.map((t) => t.name);
  const named = things.length > 1 ? `${things.slice(0, -1).join(", ")} and ${things.at(-1)}` : (things[0] ?? "");
  return `Since I started watching today: ${cats}${named ? `, mostly ${named}` : ""}.`;
}

/** The reply for either question, read from the state directory. */
export function activityReply(ask: ActivityAsk, dir: string, now: Date): string {
  const history = readHistory(dir, now);
  return ask === "now" ? nowReply(readActivity(dir, now), history, now) : todayReply(history, now);
}
