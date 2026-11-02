/*
 What a message says about his wake times (W10-B review, 2026-11-02 live gate). Pure.

 The first reader took the LAST time in a message as the wake for every day: "only on mondays, wednesdays and thursdays … on tuesday
 and friday my class is at 1:30pm so i'll wake at 9am as usual" saved 9:00 for Mon/Wed/Thu. Now the message is read as a sequence of
 day groups, "other days" markers and times, sentence by sentence, and each time binds to the nearest group:
   "6am mon wed thu, otherwise 9"                  → Mon/Wed/Thu 6:00, the rest 9:00
   "6am on monday, wednesday and thursday and 9am on the other days" → same
   "tues n fri my class is at 1:30 so ill get up at 9 like normal"  → the rest 9:00 (the class time is not a wake time)
 A day group with no time of its own is the main days (unless its clause is only about a class); a time with no group is the main wake.
*/

/** Wake days as orion-sleepplan reads them: mon..sun, "weekdays", "weekends", "all", "gym". */
export type DayWake = { days: string[]; wake: string };
export type Draft = {
  wake?: string; days?: string[]; rest?: string; also?: DayWake[]; lead?: number | null; sleep?: number;
  /** A standing alarm he asked for outright ("set a 6am alarm every mon wed thu"): saved without the interview. */
  direct?: boolean;
  /** The early wake is for the gym ("6am for the gym", "up at 6 mon wed thu for lifting"): those days are his gym days. */
  forGym?: boolean;
};

const pad = (n: number): string => String(n).padStart(2, "0");
export const clean = (m: string): string => m.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
export const num = (raw: string): number => NUM[raw] ?? Number(raw);

// ── how long before class, how long asleep ────────────────────────────────────────────────────────────────────────────
export const AMOUNT = String.raw`(\d+(?:\.\d+)?|an?|one|two|three|four|five|six)\s*(and a half\s*)?(h|hrs?|hours?|m|mins?|minutes?)?\s*(and a half\s*)?`;
export const LEAD = new RegExp(String.raw`\b(?:at ?least |like |about |around |~)?${AMOUNT}(?:early\s+)?(?:before|ahead of|prior to|b4)\s+(?:my |a |the |any |each |every )?(?:first |1st )?(?:class|classes|lecture|lectures|lab|labs|school|uni)\b(?:\s+(?:min(?:imum)?|at least))?`);
const FOR_GYM = /\bfor (?:the )?(?:gym|lifting|lift|a lift|workouts?|training)\b|\b(?:hit(?:ting)?|go(?:ing)? to|get(?:ting)? to) the gym\b|\bgym (?:first|in the morning|before)\b/;
const SLEEP_HOURS = /\b(\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?)\s+(?:of\s+)?sleep\b/;

export function leadMinutes(m: RegExpMatchArray, bareIsHours: boolean): number | undefined {
  const n = num(m[1]!) + (m[2] || m[4] ? 0.5 : 0);
  const unit = m[3];
  const minutes = unit ? (/^h/.test(unit) ? n * 60 : n) : bareIsHours && n <= 6 ? n * 60 : n >= 15 ? n : undefined;
  return minutes !== undefined && minutes >= 15 && minutes <= 360 ? Math.round(minutes) : undefined;
}

/** A wake-up time as HH:MM: 4 AM to noon, no meridiem means the morning. */
export function wakeTime(h: number, m: number, mer?: string): string | undefined {
  if (h > 23 || m > 59) return undefined;
  const hour = mer ? (h > 12 || h < 1 ? -1 : (h % 12) + (/^p/.test(mer) ? 12 : 0)) : h;
  return hour >= 4 && hour <= 12 ? `${pad(hour)}:${pad(m)}` : undefined;
}

// ── tokens ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const CLASS_TIME = /\b(?:class(?:es)?|lectures?|labs?)\b[^,.;]{0,12}?\b(?:is|are|at|starts?|begins?)\s*(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:class|lecture|lab)\b/g;
const DAY_WORD = /^(mon(?:day)?|tues?(?:day)?|weds?|wednesday|thu|thur|thurs|thursday|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?$/;
/** Multi-word day sets and "the other days" markers, longest first. */
const PHRASES: Array<[string[], { day?: string; rest?: true }]> = [
  [["rest", "of", "the", "week"], { rest: true }], [["every", "day", "of", "the", "week"], { day: "all" }],
  [["monday", "through", "friday"], { day: "weekdays" }], [["mon", "through", "fri"], { day: "weekdays" }], [["monday", "to", "friday"], { day: "weekdays" }],
  [["the", "other", "days"], { rest: true }], [["all", "the", "days"], { day: "all" }], [["like", "normal"], { rest: true }], [["like", "usual"], { rest: true }], [["as", "usual"], { rest: true }], [["as", "normal"], { rest: true }],
  [["other", "days"], { rest: true }], [["other", "day"], { rest: true }], [["the", "rest"], { rest: true }], [["every", "day"], { day: "all" }],
  [["each", "day"], { day: "all" }], [["all", "week"], { day: "all" }], [["every", "morning"], { day: "all" }], [["week", "days"], { day: "weekdays" }],
  [["school", "days"], { day: "weekdays" }], [["gym", "days"], { day: "gym" }], [["gym", "day"], { day: "gym" }],
  [["everyday"], { day: "all" }], [["daily"], { day: "all" }], [["weekdays"], { day: "weekdays" }], [["weekday"], { day: "weekdays" }],
  [["weekends"], { day: "weekends" }], [["weekend"], { day: "weekends" }], [["mon-fri"], { day: "weekdays" }],
  [["otherwise"], { rest: true }], [["usual"], { rest: true }], [["usually"], { rest: true }], [["normal"], { rest: true }],
  [["normally"], { rest: true }], [["regular"], { rest: true }],
];
const CONNECT = new Set(["and", "&", "n", "or", "plus", "on", ",", "+"]);
const CLAUSE_BREAK = new Set([",", "so", "but", "because", "cuz", "since"]);
const TIME_LEAD = new Set(["at", "around", "by", "for", "bout", "about", "like", "~", "to"]);
const UNIT = /^(?:h|hrs?|hours?|m|mins?|minutes?|days?|%|times?)$/;
const CLASS_WORD = /^(?:class(?:es)?|lectures?|labs?|classtime)$/;

type Item = { kind: "day"; day: string; at: number; end: number } | { kind: "rest"; at: number; end: number } | { kind: "time"; t: string; at: number };

const startsGroup = (words: string[], i: number): boolean =>
  DAY_WORD.test(words[i] ?? "") || PHRASES.some(([p]) => p.every((w, k) => words[i + k] === w));

function timeAt(words: string[], i: number, items: Item[]): { t: string; len: number } | undefined {
  const w = words[i]!;
  const m = w.match(/^~?(\d{1,2})(?::(\d{2}))?(am|pm|a\.m\.?|p\.m\.?)?(ish)?$/);
  if (!m) return undefined;
  const nextMer = !m[3] && /^(?:am|pm|a\.m\.?|p\.m\.?)$/.test(words[i + 1] ?? "") ? words[i + 1] : undefined;
  const mer = m[3] ?? nextMer;
  if (UNIT.test(words[i + (nextMer ? 2 : 1)] ?? "")) return undefined;
  const prevRest = items.length > 0 && items[items.length - 1]!.kind === "rest" && i - (items[items.length - 1] as { end: number }).end <= 2;
  // A bare hour right before its days counts too: "7 on sat", "9 otherwise", "10 the rest of the week".
  const after = i + (nextMer ? 2 : 1);
  const nextGroup = startsGroup(words, after) || (words[after] === "on" && startsGroup(words, after + 1));
  if (!mer && !m[2] && !m[4] && !TIME_LEAD.has(words[i - 1] ?? "") && !prevRest && !nextGroup) return undefined;
  const t = wakeTime(Number(m[1]), Number(m[2] ?? 0), mer);
  return t ? { t, len: nextMer ? 2 : 1 } : undefined;
}

function tokens(words: string[]): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < words.length;) {
    const phrase = PHRASES.find(([p]) => p.every((w, k) => words[i + k] === w));
    if (phrase) {
      const [p, v] = phrase;
      items.push(v.rest ? { kind: "rest", at: i, end: i + p.length - 1 } : { kind: "day", day: v.day!, at: i, end: i + p.length - 1 });
      i += p.length; continue;
    }
    const d = words[i]!.match(DAY_WORD);
    if (d) { items.push({ kind: "day", day: d[1]!.slice(0, 3), at: i, end: i }); i += 1; continue; }
    const t = timeAt(words, i, items);
    if (t) { items.push({ kind: "time", t: t.t, at: i }); i += t.len; continue; }
    i += 1;
  }
  return items;
}

type Group = { kind: "days"; days: string[]; at: number; end: number; wake?: string } | { kind: "rest"; at: number; end: number; wake?: string };

/** Consecutive day words joined only by "and", commas or "n" make one group. */
function groupsOf(items: Item[], words: string[]): { groups: Group[]; times: Array<{ t: string; at: number }> } {
  const groups: Group[] = [];
  for (const it of items) {
    if (it.kind === "time") continue;
    const last = groups[groups.length - 1];
    const joined = last?.kind === "days" && it.kind === "day" && words.slice(last.end + 1, it.at).every((w) => CONNECT.has(w));
    if (joined) { last.days.push(it.day); last.end = it.end; continue; }
    groups.push(it.kind === "day" ? { kind: "days", days: [it.day], at: it.at, end: it.end } : { kind: "rest", at: it.at, end: it.end });
  }
  return { groups, times: items.filter((it): it is Extract<Item, { kind: "time" }> => it.kind === "time") };
}

const distance = (t: number, g: Group): number => (t < g.at ? g.at - t : t > g.end ? t - g.end : 0);

/** True when the clause holding this group is about a class ("tue and fri my class is at 1:30"). */
function classClause(words: string[], g: Group): boolean {
  let a = g.at; while (a > 0 && !CLAUSE_BREAK.has(words[a - 1]!)) a -= 1;
  let b = g.end; while (b < words.length - 1 && !CLAUSE_BREAK.has(words[b + 1]!)) b += 1;
  return words.slice(a, b + 1).some((w) => CLASS_WORD.test(w));
}

/** Everything a message says about the plan. Pure. */
export function slotsOf(message: string): Draft {
  let text = clean(message).replace(CLASS_TIME, " classtime ");
  const draft: Draft = {};
  const lead = text.match(LEAD);
  if (lead) { const n = leadMinutes(lead, false); if (n !== undefined) draft.lead = n; text = text.replace(lead[0], " "); }
  const sleep = text.match(SLEEP_HOURS);
  if (sleep && Number(sleep[1]) >= 5 && Number(sleep[1]) <= 11) { draft.sleep = Number(sleep[1]); text = text.replace(sleep[0], " "); }
  const mainDays = new Set<string>();
  const also: DayWake[] = [];
  let wake: string | undefined;
  for (const sentence of text.split(/[.!?;\n]+/)) {
    const words = sentence.replace(/,/g, " , ").replace(/\//g, " ").split(/\s+/).filter(Boolean);
    const { groups, times } = groupsOf(tokens(words), words);
    const loose: string[] = [];
    for (const t of times) {
      const best = groups.filter((g) => !g.wake).sort((a, b) => distance(t.at, a) - distance(t.at, b) || b.at - a.at)[0];
      if (best) best.wake = t.t; else loose.push(t.t);
    }
    for (const g of groups) {
      if (g.kind === "rest") { if (g.wake && !draft.rest) draft.rest = g.wake; continue; }
      if (g.wake) also.push({ days: g.days, wake: g.wake });
      else if (!classClause(words, g)) g.days.forEach((d) => mainDays.add(d));
    }
    if (!wake && loose[0]) wake = loose[0];
  }
  if (!wake && !mainDays.size && also.length) { const first = also.shift()!; wake = first.wake; first.days.forEach((d) => mainDays.add(d)); }
  if (wake) draft.wake = wake;
  if (mainDays.size) draft.days = [...mainDays];
  if (also.length) draft.also = also;
  if (FOR_GYM.test(text)) draft.forGym = true;
  return draft;
}
