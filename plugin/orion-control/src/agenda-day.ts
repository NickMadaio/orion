/*
 What the calendar held on a day that is over (w20 round 3). `orion-reschedule show` refuses a past date, so yesterday could never be read
 and "what did i have on yesterday evening" was answered "I don't have access to yesterday's calendar" (gate #63). `orion-agenda day <date>`
 can read it: a dated header, then "  6:00 PM — Dinner" lines. Parsed here; the reply is worded by code, never by the model.
 Pure except liveAgendaDay.
*/
import { execFile } from "node:child_process";

export type AgendaEvent = { title: string; start: string };
export type AgendaDay = { date: string; events: AgendaEvent[] };
export type AgendaRun = (date: string) => Promise<AgendaDay | undefined>;

const SCRIPT = "/Users/nickmadaio/Desktop/ORION/scripts/orion-agenda";
const LINE = /^\s{1,4}(\d{1,2}):(\d{2})\s*([AP]M)\s+—\s+(.+?)\s*$/;
const pad = (n: number) => String(n).padStart(2, "0");

/** The timed events of `orion-agenda day` output; the all-day and id lines are not events. */
export function parseAgenda(date: string, stdout: string): AgendaDay | undefined {
  if (!/asked about/i.test(stdout)) return undefined;
  const events = stdout.split("\n").flatMap((line): AgendaEvent[] => {
    const m = LINE.exec(line);
    if (!m) return [];
    const h = (Number(m[1]) % 12) + (m[3] === "PM" ? 12 : 0);
    return [{ title: m[4]!, start: `${pad(h)}:${m[2]}` }];
  });
  return { date, events };
}

export const liveAgendaDay: AgendaRun = (date) => new Promise((resolve) => {
  execFile(SCRIPT, ["day", date], { timeout: 20_000 }, (error, stdout) => resolve(error ? undefined : parseAgenda(date, String(stdout))));
});

export type Part = "morning" | "afternoon" | "evening" | "night";
const RANGE: Record<Part, [number, number]> = { morning: [0, 12 * 60], afternoon: [12 * 60, 17 * 60], evening: [17 * 60, 24 * 60], night: [21 * 60, 24 * 60] };
const min = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const spoken = (t: string): string => { const h = Number(t.slice(0, 2)); return `${h % 12 || 12}:${t.slice(3, 5)} ${h < 12 ? "AM" : "PM"}`; };
const short = (title: string): string => title.replace(/\s+—\s+Lecture$/i, "");
const list = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** "what did i have on yesterday evening" / "what was on last night": the day word and the part of it he asked about. */
export function readPastDayAsk(message: string): { day: "yesterday"; part?: Part } | undefined {
  const m = message.toLowerCase().replace(/[’`]/g, "'");
  if (!/\b(?:what|anything|did i have|was i|had i|what's|whats)\b/.test(m) || !/\b(?:yesterday|last night)\b/.test(m)) return undefined;
  if (!/\b(?:have on|had on|have|had|was on|was there|on my|in my|scheduled|planned|calendar|agenda|schedule|do|did)\b/.test(m)) return undefined;
  if (/\b(?:eat|ate|drink|drank|sleep|slept|calories|spend|spent|weigh|gym)\b/.test(m) && !/\b(?:calendar|schedule|agenda|on)\b/.test(m)) return undefined;
  const part: Part | undefined = /\blast night\b|\byesterday (?:night|evening)\b|\bevening\b/.test(m) ? (/\bnight\b/.test(m) && !/\bevening\b/.test(m) ? "night" : "evening")
    : /\byesterday afternoon\b|\bafternoon\b/.test(m) ? "afternoon" : /\byesterday morning\b|\bmorning\b/.test(m) ? "morning" : undefined;
  return { day: "yesterday", ...(part ? { part } : {}) };
}

/** The spoken answer for a past day, from what the calendar said. `dateLabel` is the day with its date ("Wednesday 4 Nov"). */
export function pastDayReply(agenda: AgendaDay | undefined, ask: { part?: Part }, dateLabel: string): string {
  if (!agenda) return `I couldn't read your calendar for ${dateLabel} just now, so I won't guess what was on it. Ask me again in a minute.`;
  const [lo, hi] = ask.part ? RANGE[ask.part] : [0, 24 * 60];
  const when = ask.part ? `${dateLabel} ${ask.part}` : dateLabel;
  const rows = agenda.events.filter((e) => min(e.start) >= lo && min(e.start) < hi);
  if (!rows.length) return `Nothing was on your calendar for ${when}.`;
  return `On ${when} you had ${list(rows.map((e) => `${short(e.title)} at ${spoken(e.start)}`))}.`;
}
