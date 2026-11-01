/*
 "Am I free Saturday evening?" answered from his calendar by code (wave 9 B, gate run-1101085557: cha-friend-c).

 The reply was "I don't have your calendar for Saturday… check the calendar app" with no tool call. The turn had been handed TODAY's list
 (the day-question route reads today or tomorrow, nothing else), so a question about Saturday had nothing to answer from and the 9B said
 so. A question about whether a named day, or a part of one, is free now reads that day (`show --json --date <day>`) and answers from it:
 fixed things first (classes, plans with people, his own events), then ORION's own movable blocks. It never says it cannot see the calendar:
 if the read itself fails it says the read failed. Pure apart from the injected read. Read-only: nothing is booked or moved.
*/
import { ampm, toMin } from "./intent-time.js";
import type { Day, DayBlock } from "./schedule-flow.js";

type Part = "morning" | "afternoon" | "evening" | "night";
export type AvailabilityAsk = { dateArgs: string[]; label: string; day: string; part?: Part; today: boolean };

const FULL_DAY = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const SAFE_SHORT = "tues?|thu|thur|thurs|fri";
const PART_WORD = "morning|mornin|afternoon|aft|evening|eve|night|tonight";
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// mon / wed / sat / sun are also ordinary words: a day only after on / this / next / for / by, or before a part of the day.
const DAY_RE = new RegExp(`\\b(?:(?<full>${FULL_DAY})|(?<safe>${SAFE_SHORT})|(?:(?:on|this|next|for|by|every)\\s+(?<ctx>mon|weds?|sat|sun))|(?<ctx2>mon|weds?|sat|sun)(?=\\s+(?:${PART_WORD})\\b)|(?<tmr>tomorrow|tmrw|tmr|tomorow))\\b`);
const TODAY_PART = /\b(?:tonight|this\s+(?:morning|afternoon|evening|aft|eve)|later\s+tonight)\b/;
const PART_RE = new RegExp(`\\b(?<part>${PART_WORD})\\b`);
// Free / busy / what's on: the question about whether the time is taken, not whether something would fit in it.
const FREE_WORD = /\b(?:free|busy|available|avail|open|booked up|tied up|occupied|clear)\b/;
const OPENER = /^(?:(?:ok(?:ay)?|so|hey|orion|yo|um|uh|btw|quick(?:ly)?|pls|please|wait|and|also)[,\s]+)*(?:am i|are we|are you|are u|r we|r u|is|are|am|i free|we free|will i|will we|can we|can i|do i|do we|have i|have we|any|anything|something|stuff|what|whats|what's|hows|how's|is there|check|tell me|can you|could you|u free|you free|free)\b/;
const WHATS_ON = /\b(?:anything|something|stuff|plans?|events?|classes|class|lectures?|going on|on my (?:calendar|schedule)|scheduled|on)\b/;
const HAVE_ON = /\b(?:do i|do we|have i|have we|what do i|what do we|what have i|whats|what's|is there|any|anything)\b[^?]*\b(?:on|got|have|going on|scheduled|planned|booked|up)\b/;
const NOT_THIS = /\b(?:time for|room for|squeeze|fit|slot|how long|how much|due|deadline|assignment|homework|remind|weather|rain|open(?:s|ing)? (?:at|till|until)|closes?|hours)\b|\b(?:move|push|pull|add|put|book|cancel|drop|delete|remove|shift|swap|extend|shorten|skip|reschedule|replan|fix|set up)\b/;

const todayLabel = (part?: Part): string => (!part ? "today" : part === "night" ? "tonight" : `this ${part}`);
const clean = (m: string): string => m.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9'?\s]/g, " ").replace(/\s+/g, " ").trim();

/** Does this message ask whether a named day / part of day is free, or what is on it? Undefined for anything else. */
export function readAvailability(message: string, now: Date): AvailabilityAsk | undefined {
  const m = clean(message);
  if (!m || NOT_THIS.test(m)) return undefined;
  const d = DAY_RE.exec(m)?.groups;
  const tonight = /\btonight\b/.test(m) || TODAY_PART.test(m);
  const dayNamed = !!(d?.full || d?.safe || d?.ctx || d?.ctx2 || d?.tmr);
  if (!dayNamed && !tonight) return undefined;
  const asks = FREE_WORD.test(m) ? OPENER.test(m) || /\?$/.test(m) || /\bi(?:'?m| am)\b|\bwe(?:'?re| are)\b/.test(m) : (WHATS_ON.test(m) && OPENER.test(m)) || HAVE_ON.test(m);
  if (!asks) return undefined;
  const partWord = PART_RE.exec(m)?.groups?.part;
  const part: Part | undefined = !partWord ? undefined : /^morn/.test(partWord) ? "morning" : /^aft/.test(partWord) ? "afternoon" : /^eve/.test(partWord) || partWord === "tonight" ? "evening" : "night";
  if (!dayNamed) return { dateArgs: [], label: todayLabel(m.includes("tonight") ? "night" : part), day: "today", part: part ?? "evening", today: true };
  const named = (d!.full ?? d!.safe ?? d!.ctx ?? d!.ctx2 ?? "").toLowerCase();
  const partLabel = part ? ` ${part === "night" ? "night" : part}` : "";
  if (d!.tmr) return { dateArgs: ["--date", "tomorrow"], label: `tomorrow${partLabel}`, day: "tomorrow", ...(part ? { part } : {}), today: false };
  const idx = WEEKDAYS.findIndex((w) => w.startsWith(named.slice(0, 3)));
  if (idx < 0) return undefined;
  const label = `${WEEKDAYS[idx]!.replace(/^./, (c) => c.toUpperCase())}${partLabel}`;
  // His own weekday ("am i free thursday evening" on a Thursday) is today, unless he said "next".
  if (idx === now.getDay() && !/\bnext\b/.test(m)) return { dateArgs: [], label: todayLabel(part), day: "today", ...(part ? { part } : {}), today: true };
  return { dateArgs: ["--date", WEEKDAYS[idx]!], label, day: WEEKDAYS[idx]!, ...(part ? { part } : {}), today: false };
}

const WINDOW: Record<Part, [number, number]> = { morning: [6 * 60, 12 * 60], afternoon: [12 * 60, 17 * 60], evening: [17 * 60, 24 * 60], night: [19 * 60, 24 * 60] };
const span = (b: DayBlock): string => `${ampm(toMin(b.start))}–${ampm(toMin(b.end))}`;
const name = (b: DayBlock): string => b.title.replace(/\s+—\s+Lecture$/i, "").replace(/\s+—.*$/, "");
const list = (xs: string[]): string => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const isFixed = (b: DayBlock): boolean => b.fixed || b.kind === "class";

/** What he hears: free, free apart from ORION's own blocks, or what is on it. Built from the blocks the read returned and nothing else. */
export function availabilityReply(ask: AvailabilityAsk, day: Day, now: Date): string {
  const [from, to] = ask.part ? WINDOW[ask.part] : [0, 24 * 60];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const start = ask.today ? Math.max(from, nowMin) : from;
  if (ask.today && ask.part && to <= nowMin) return `That part of today is already over, so there's nothing left to book in it.`;
  const inside = day.blocks.filter((b) => toMin(b.start) < to && toMin(b.end) > start).sort((a, b) => toMin(a.start) - toMin(b.start));
  const fixed = inside.filter(isFixed); const mine = inside.filter((b) => !isFixed(b));
  const say = (bs: DayBlock[]) => list(bs.map((b) => `${name(b)}, ${span(b)}`));
  if (!inside.length) return `Yes, you're free ${ask.label}. Nothing is on your calendar then.`;
  if (!fixed.length) return `Nothing fixed ${ask.label}. Just ${say(mine)}, which ${mine.length === 1 ? "is a block" : "are blocks"} of mine, so I can move ${mine.length === 1 ? "it" : "them"} if you want the time.`;
  return `Not completely. ${ask.label.replace(/^./, (c) => c.toUpperCase())} you have ${say(fixed)}${mine.length ? `, plus ${say(mine)} of mine, which I can move` : ""}.`;
}

/** The whole route: read the named day, answer from it. Read failing is said as a failed read, never as "I don't have your calendar". */
export async function answerAvailability(message: string, now: Date, readDay: (dateArgs: string[]) => Promise<Day | undefined>): Promise<string | undefined> {
  const ask = readAvailability(message, now);
  if (!ask) return undefined;
  const day = await readDay(ask.dateArgs).catch(() => undefined);
  if (!day || !Array.isArray(day.blocks)) return `I couldn't read your calendar for ${ask.label.replace(/\s+(?:morning|afternoon|evening|night)$/, "")} just now, so I can't say if you're free. Try me again in a moment.`;
  return availabilityReply(ask, day, now);
}
