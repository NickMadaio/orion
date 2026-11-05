/*
 Health, answered and written by code (gate run-1031202318, cluster 5: hea-log-meal, hea-gym-streak, hea-bedtime-set, hea-sleep-adjust).

 What the gate saw: "had a big lunch, like pasta" got "Did you finish your workout yet?" and nothing was logged; "log lunch at 1pm" was refused
 as already over ("Exec failed" leaked); "how many gym days this week" got the weather; "set my bedtime to 11:30" got "I don't see a command".

   meal     "had lunch", "ate at 1", "log lunch at 1pm: pasta, big portion": one entry in health-log.json's nutritionLog (the file and entry shape the
            Orion app reads). A past time is the point of the log, never a reason to refuse. Calories are not guessed: the entry says 0.
   gym      "have i been going to the gym", "how many gym days this week", "my gym streak", "what did i lift last": counted from the real history,
            the union of health-log.json workouts, the plan history (life-history.jsonl: planned and actually started) and logged.jsonl.
   bedtime  "set my bedtime to 11:30", "i wanna sleep earlier": the existing preference, `bedtime` in life-config.json (what orion-life set writes
            and the night plan, wind-down and review time read). No time said: 30 minutes earlier than now, and the reply says that was my assumption.
   sleep    sleepLine(): last night's sleep and recovery from the health log, for the lightened-day reply (day-lighten.ts) to state.
 Every reply is built from what was read or written here this turn.
*/
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FlowResult } from "./schedule-flow.js";
import { sandboxNowMs } from "./plugin-clock.js";
import { readWaterGoal, runWaterGoal, type WaterGoalRead } from "./water-goal.js";
import { readIntakeQuestion, readWaterLog, runIntake, type IntakeRead } from "./intake-chat.js";   // w20 R3
import { mutate, readHealthLog, today as dayOf, type HealthLogFile } from "./health.js";

export type MealRead = { kind: "meal"; meal: string; title: string; notes: string; at: Date };
export type GymRead = { kind: "gym"; scope: "week" | "last7" | "recent" | "plan" };
export type BedtimeRead = { kind: "bedtime"; read: boolean; time?: string; week: boolean; /** every night only when he said set/make/change on "bedtime" or "this week"; else tonight (as bedtime-read.ts) */ scope?: "tonight" | "always" };
export type HealthRead = MealRead | GymRead | BedtimeRead | WaterGoalRead | IntakeRead;

const pad = (n: number) => String(n).padStart(2, "0");
const clock12 = (d: Date) => `${(d.getHours() + 11) % 12 + 1}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
const hhmm12 = (t: string) => { const [h, m] = t.split(":").map(Number); return clock12(new Date(2000, 0, 1, h ?? 0, m ?? 0)); };
const weekday = (key: string) => new Date(`${key}T12:00`).toLocaleDateString("en-GB", { weekday: "short" });
const listed = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
const dayKey = (d: Date) => dayOf(d);

// ---- reading what he said ----
const MEAL_WORD = /\b(breakfast|brunch|lunch|dinner|supper|snack|meal)\b/i;
const LOGGED = /\b(?:had|ate|eaten|just ate|just had|finished eating|log(?:ged)?|record(?:ed)?|note(?:d)?|put down)\b/i;
// A plan, a question, a calendar item or a refusal is not a meal eaten.
const NOT_EATEN = /\?|\b(?:add|put|schedule|book|remind|calendar|plan|tomorrow|tonight|should|gonna|going to|about to|wanna|want to|will|need to|have to|haven'?t|havent|hadn'?t|didn'?t|didnt|not|skip(?:ped)?|forgot|missed|no)\b|\b(?:what|when|where|how)\b/i;
const PORTION = /\b(big|large|huge|massive|giant|small|tiny|light|half(?! an? (?:hour|hr))|quick|proper|heavy)\b(?:\s+(?:portion|serving|meal|plate|bowl))?/gi;
const AGO = /\b(\d+|an?|half an?)\s*(hours?|hrs?|h|minutes?|mins?|m)\s+ago\b/i;
const CLOCK = /\b(?:at|around|about|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?|\b(noon|midday)\b/i;

/** The moment he ate: "an hour ago", "at 1pm", "at 1" (the latest such hour already past), "at noon"; else now. Past times are always fine. */
function mealTime(m: string, meal: string, now: Date): Date {
  const ago = AGO.exec(m);
  if (ago) {
    const n = /^half/i.test(ago[1]!) ? 0.5 : /^an?$/i.test(ago[1]!) ? 1 : Number(ago[1]);
    return new Date(now.getTime() - n * (/^h/i.test(ago[2]!) ? 60 : 1) * 60_000);
  }
  const c = CLOCK.exec(m);
  if (!c) return now;
  const minute = c[4] ? 0 : Number(c[2] ?? 0);
  const at = (h: number, back = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, h, minute);
  if (c[4]) return at(12);
  const h = Number(c[1]) % 12;
  const meridiem = c[3]?.toLowerCase().replace(/\./g, "");
  if (meridiem) return at(h + (meridiem === "pm" ? 12 : 0));
  if (/breakfast/i.test(meal)) return at(h);
  const options = [at(h), at(h + 12)].filter((d) => d.getTime() <= now.getTime() + 60_000);
  const best = options.sort((a, b) => b.getTime() - a.getTime())[0];
  return best ?? at(h + 12, 1);
}

function mealTitle(raw: string, meal: string): { title: string; notes: string } {
  const after = /(?::|\s[-—]\s|,\s*like\s|\blike\s|\bof\s)(.+)$/i.exec(raw)?.[1]
    ?? /\b(?:had|ate|eaten)\s+(?:a |an |some |the |my )?(.+?)(?=\s+(?:for|at|around|about|with|just now|today|earlier)\b|\s+\d+\s*(?:hours?|mins?|minutes?)\s+ago|[.!]|$)/i.exec(raw)?.[1]
    ?? "";
  const notes = [...raw.matchAll(PORTION)].map((p) => p[0].toLowerCase().replace(/\s+(?:meal|plate|bowl)$/, ""));
  const food = after.replace(PORTION, "").replace(CLOCK, "").replace(AGO, "").replace(new RegExp(`\\b${meal}\\b`, "i"), "")
    .split(",").map((p) => p.replace(/^\s*(?:like|some|a|an|the|my|just)\s+/i, "").replace(/\b(?:portion|serving)s?\b/gi, "").replace(/[^\w &'/+-]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const title = food.join(", ");
  return { title: title ? title.charAt(0).toUpperCase() + title.slice(1) : meal, notes: [...new Set(notes)].map((n) => (/portion$/.test(n) ? n : `${n} portion`)).join(", ") };
}

export function readMeal(message: string, now: Date): MealRead | null {
  const m = message.trim().replace(/\s+/g, " ");
  if (m.length > 140 || NOT_EATEN.test(m)) return null;
  const word = MEAL_WORD.exec(m)?.[1]?.toLowerCase();
  const ateWord = /\b(?:ate|eaten|just ate)\b/i.test(m);
  if (!LOGGED.test(m) || (!word && !ateWord)) return null;
  const at = mealTime(m, word ?? "", now);
  const meal = word && word !== "meal" ? word : at.getHours() < 11 ? "breakfast" : at.getHours() < 15 ? "lunch" : at.getHours() < 17 ? "snack" : "dinner";
  const { title, notes } = mealTitle(m, word ?? "");
  return { kind: "meal", meal: meal.charAt(0).toUpperCase() + meal.slice(1), title: title === (word ?? "") || !title ? meal.charAt(0).toUpperCase() + meal.slice(1) : title, notes, at };
}

const GYM_WORD = String.raw`(?:gym|workouts?|work(?:ing)? out|lifting|lifts?|training)`;
const GYM_ASK = new RegExp(String.raw`\b(?:how (?:many|often)|have i been|did i (?:go|make it|hit|get to)|am i (?:going|keeping up|being consistent)|do i (?:go|work out)|been (?:going|hitting|to))\b[^.?!]{0,40}\b${GYM_WORD}\b|\b${GYM_WORD}\s+(?:days?|streak|sessions?|count)\b|\bmy (?:gym |workout )?streak\b|\b(?:last|recent|latest|previous) (?:workouts?|gym sessions?|lifts?)\b|\bwhat did i (?:lift|do at the gym|train)\b`, "i");
const GYM_CHANGE = /\b(?:move|add|cancel|skip|schedule|book|remind|shorten|drop|push|swap|start|log|logged)\b|\b(?:reps?|sets?|weight|pr|calories|protein)\b/i;

// "what gym session should i do today", "which workout should i do", "what should i lift": a question about what to DO, not about his history (live gate 4 #94).
const GYM_PLAN_ASK = new RegExp(String.raw`\b(?:what|which|whats|what'?s)\b[^.?!]{0,40}\b${GYM_WORD}\b[^.?!]{0,30}\b(?:should|shall|do i|to do|to hit|to do today|next)\b|\b(?:what|which)\b[^.?!]{0,20}\b(?:should|shall)\s+i\b[^.?!]{0,30}\b(?:lift|train|do at the gym|do for (?:gym|my workout)|work out|hit)\b|\bwhat (?:should|shall) i do (?:at|in) the gym\b`, "i");

export function readGym(message: string): GymRead | null {
  const m = message.trim();
  if (m.length <= 120 && GYM_PLAN_ASK.test(m) && !GYM_CHANGE.test(m)) return { kind: "gym", scope: "plan" };
  if (m.length > 120 || !GYM_ASK.test(m) || GYM_CHANGE.test(m)) return null;
  return { kind: "gym", scope: /\b(?:last|recent|latest|previous) (?:workouts?|gym sessions?|lifts?)\b|\bwhat did i (?:lift|do at the gym|train)\b/i.test(m) ? "recent" : /\bthis week\b/i.test(m) ? "week" : "last7" };
}

const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?|(midnight)`;
const BED_WORD = String.raw`(?:bed\s?time|bed|be asleep|lights out|sleep(?:ing)?|asleep)`;
const BED_SET = new RegExp(String.raw`\b(?:set|change|make|move|put|update|push|pull|switch)\b[^.?!]{0,25}\bbed\s?time\b[^.?!]{0,12}?(?:to|at|for|by|:)?\s*(?:${TIME})|\b${BED_WORD}\b[^.?!]{0,12}\b(?:by|at|before|to)\s+(?:${TIME})|\bbed\s?time\s+(?:is|of)\s+(?:${TIME})`, "i");
const BED_EARLIER = /\b(?:sleep|go to bed|get to bed|get to sleep|be in bed|be asleep|turn in|hit the hay)\s+(?:a (?:bit|little) |way |much )?earlier\b|\bearlier\s+(?:bed\s?time|night|nights|to bed)\b|\bbed\s?time\b[^.?!]{0,20}\bearlier\b|\bearlier\b[^.?!]{0,20}\bbed\s?time\b/i;
// Past tense is a report, and "tonight" / "early night" is a one-off: neither is a bedtime setting (REV4 item 4).
const BED_PAST = /\b(?:went|fell|got|was|were|slept|woke|stayed up|last night|yesterday|the other night)\b/i;
const BED_SET_VERB = /\b(?:set|change|make|move|put|update|push|pull|switch)\b[^.?!,]{0,25}\bbed\s?time\b/i;
const BED_PAST_NIGHT = /\b(?:last night|yesterday|the other night)\b/i;
const BED_ONE_OFF = /\b(?:tonight|tn|early night|late night|an early one)\b/i;
const BED_ASK = /\b(?:what(?:'s|s| is)?|when(?:'s|s| is)?|tell me)\b[^.?!]{0,20}\bmy bed\s?time\b|\bwhat time (?:is|am i|should i)[^.?!]{0,20}\b(?:bed|sleep|asleep)\b/i;

function bedTime(match: RegExpExecArray, first: number): string | undefined {
  for (let i = first; i + 3 < match.length + 1; i += 4) {
    if (match[i + 3]) return "00:00";
    if (match[i]) {
      let h = Number(match[i]) % 12;
      const meridiem = match[i + 2]?.toLowerCase().replace(/\./g, "");
      if (meridiem) h += meridiem === "pm" ? 12 : 0;
      else if (Number(match[i]) >= 8 && Number(match[i]) <= 11) h += 12;   // 11:30 is 23:30; 1 is 01:00; 12 is midnight
      const minute = Number(match[i + 1] ?? 0);
      return minute < 60 ? `${pad(h)}:${pad(minute)}` : undefined;
    }
  }
  return undefined;
}

export function readBedtime(message: string): BedtimeRead | null {
  const m = message.trim();
  if (m.length > 140) return null;
  const week = /\b(?:this week|rest of the week|for the week|all week|until (?:sunday|the weekend)|through sunday)\b/i.test(m);
  if (BED_ASK.test(m)) return { kind: "bedtime", read: true, week: false };
  if (/\?/.test(m) && !/\b(?:set|change|make)\b/i.test(m)) return null;
  if (BED_ONE_OFF.test(m)) return null;
  const set = BED_SET.exec(m);
  // An imperative set-verb on "bedtime" with a time is a setting even with a past-tense aside ("set my bedtime to 11, I was wrecked").
  const explicit = !!set && BED_SET_VERB.test(m) && !BED_PAST_NIGHT.test(m);
  if (BED_PAST.test(m) && !explicit) return null;
  const time = set ? bedTime(set, 1) : undefined;
  if (time) return { kind: "bedtime", read: false, time, week, scope: week || (BED_SET_VERB.test(m) && /\bbed\s?times?\b/i.test(m)) ? "always" : "tonight" };
  if (BED_EARLIER.test(m)) return { kind: "bedtime", read: false, week };
  return null;
}

/** The first health phrase in his message, or null. Pure. */
export function readHealthIntent(message: string, now: Date): HealthRead | null {
  return readWaterGoal(message) ?? readWaterLog(message) ?? readIntakeQuestion(message) ?? readBedtime(message) ?? readGym(message) ?? readMeal(message, now);
}

// ---- meals ----
/** The same meal at (nearly) the same time within this window is one meal said twice. */
const MEAL_DUPLICATE_MS = 20 * 60_000;
export async function runMeal(read: MealRead, deps: { stateDir: string; now: Date }): Promise<FlowResult> {
  const file = join(deps.stateDir, "health-log.json");
  const entry = { id: randomUUID(), title: read.title, meal: read.meal, calories: 0, protein: 0, carbohydrates: 0, fat: 0, fiber: 0, notes: read.notes, loggedAt: read.at.toISOString() };
  const day = dayKey(read.at);
  let count = 0;
  let duplicate: Record<string, unknown> | undefined;  // assigned inside mutate
  try {
    await mutate(file, (log: HealthLogFile) => {
      const existing = log.nutritionLog?.[day] ?? [];
      duplicate = (existing as Array<Record<string, unknown>>).find((r) => String(r.meal ?? "").toLowerCase() === read.meal.toLowerCase()
        && Math.abs(Date.parse(String(r.loggedAt ?? "")) - read.at.getTime()) <= MEAL_DUPLICATE_MS);
      if (duplicate) { count = existing.length; return; }
      const rows = [...existing, entry];
      count = rows.length;
      log.nutritionLog = { ...(log.nutritionLog ?? {}), [day]: rows };
    });
  } catch {
    return { outcome: "say", kind: "plain", text: "I couldn't write to your health log just now, so that meal isn't logged." };
  }
  if (duplicate) {
    const at = new Date(String(duplicate.loggedAt));
    return { outcome: "say", kind: "plain", text: `${read.meal} is already logged at ${clock12(at)}, so I didn't add it again.`, calls: [`read health-log.json nutritionLog ${day}`], outputs: [String(count)] };
  }
  const when = day === dayKey(deps.now) ? clock12(read.at) : `${weekday(day)} ${clock12(read.at)}`;
  const what = read.title.toLowerCase() === read.meal.toLowerCase() ? "" : `: ${read.title}${read.notes ? `, ${read.notes}` : ""}`;
  const total = `${count} meal${count === 1 ? "" : "s"} logged for ${day === dayKey(deps.now) ? "today" : weekday(day)}`;
  return { outcome: "done", calls: [`write health-log.json nutritionLog ${day}`], outputs: [JSON.stringify(entry)], reply: `Logged ${read.meal.toLowerCase()} at ${when}${what}. That's ${total}; I didn't guess calories.` };
}

// ---- gym ----
type Row = Record<string, unknown>;
const jsonl = (file: string): Row[] => { try { return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Row]; } catch { return []; } }); } catch { return []; } };

/** Gym days from every record: health-log workouts, plan history (started), logged.jsonl. Missed = planned with no start and no other record. */
export async function gymHistory(stateDir: string): Promise<{ done: Set<string>; planned: Set<string>; workouts: Array<{ day: string; title: string; exercises: string[] }> }> {
  const done = new Set<string>(); const planned = new Set<string>();
  const log = await readHealthLog(join(stateDir, "health-log.json")).catch(() => undefined);
  const workouts = (log?.workouts ?? []).filter((w) => typeof w.day === "string").map((w) => ({ day: w.day, title: w.title ?? "", exercises: (w.exercises ?? []).map((e) => e.name) }));
  for (const w of workouts) done.add(w.day);
  for (const r of jsonl(join(stateDir, "life-history.jsonl"))) {
    if (typeof r.at !== "string" || !(r.kind === "gym" || /\bgym\b/i.test(String(r.what ?? "")))) continue;
    const key = dayKey(new Date(r.at));
    (r.actualStart === null || r.actualStart === undefined ? planned : done).add(key);
  }
  for (const r of jsonl(join(stateDir, "logged.jsonl"))) if (typeof r.date === "string" && (r.kind === "gym" || /\bgym\b/i.test(String(r.what ?? "")))) done.add(r.date);
  return { done, planned, workouts };
}

const daysBack = (now: Date, n: number): string[] => Array.from({ length: n }, (_, i) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1 - i))));

export async function runGym(read: GymRead, deps: { stateDir: string; now: Date }): Promise<FlowResult> {
  const { done, planned, workouts } = await gymHistory(deps.stateDir);
  const say = (text: string): FlowResult => ({ outcome: "say", kind: "plain", text, calls: ["read health-log.json workouts, life-history.jsonl, logged.jsonl"], outputs: [JSON.stringify({ done: [...done].sort(), planned: [...planned].sort() })] });
  if (read.scope === "recent") {
    const last = [...workouts].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 3);
    if (!last.length) return say(done.size ? `I have gym days on record (last: ${weekday([...done].sort().at(-1)!)}) but no lifts logged. Tell me what you did and I'll log it.` : "I have no workouts logged yet. Tell me what you lift and I'll log it.");
    return say(`Last ${last.length === 1 ? "workout" : `${last.length} workouts`}: ${last.map((w) => `${weekday(w.day)} ${w.day.slice(8)}/${w.day.slice(5, 7)}${w.exercises.length ? ` (${listed(w.exercises.slice(0, 4))})` : w.title ? ` (${w.title})` : ""}`).join("; ")}.`);
  }
  if (read.scope === "plan") {
    // What to do today, from what he did last: the last lift and how long ago, never a bare history count.
    const lastDay = [...done].sort().at(-1);
    const last = [...workouts].sort((a, b) => b.day.localeCompare(a.day))[0];
    const gone = lastDay ? Math.round((new Date(`${dayKey(deps.now)}T12:00`).getTime() - new Date(`${lastDay}T12:00`).getTime()) / 86400_000) : undefined;
    if (gone === undefined) return say("I've got no gym on record yet, so there's nothing to rotate from. How long have you got, and what do you want to hit: push, pull, legs, or a full body?");
    const what = last && last.day === lastDay ? (last.exercises.length ? `${listed(last.exercises.slice(0, 4))}` : last.title || "a session") : "a gym day";
    const ago = gone === 0 ? "today" : gone === 1 ? "yesterday" : `${gone} days ago`;
    return say(`Your last gym was ${ago} (${what}), so today's the day to train something different. How long have you got, and do you want push, pull, legs or a full body?`);
  }
  const sinceMonday = (deps.now.getDay() + 6) % 7 + 1;   // days in this week so far, Monday first
  const useWeek = read.scope === "week" && sinceMonday >= 3;
  const window = daysBack(deps.now, useWeek ? sinceMonday : 7);
  const went = window.filter((d) => done.has(d));
  const label = useWeek ? "so far this week" : "in the last 7 days";
  const early = read.scope === "week" && !useWeek ? "The week has only just started, so this is the last 7 days. " : "";
  if (!went.length && !window.some((d) => planned.has(d))) return say(`${early}I have no gym logged ${label}, so I can't say you've been going. Tell me when you go and I'll log it.`);
  let streak = 0;
  for (let i = window.length - 1; i >= 0 && done.has(window[i]!); i -= 1) streak += 1;
  if (!done.has(window.at(-1)!) && window.length > 1) { streak = 0; for (let i = window.length - 2; i >= 0 && done.has(window[i]!); i -= 1) streak += 1; }
  const missed = window.filter((d) => !done.has(d) && d !== window.at(-1));
  const parts = [`${early}Gym ${label}: ${went.length} of ${window.length} days${went.length ? ` (${went.map(weekday).join(", ")})` : ""}.`,
    missed.length ? `Nothing logged for ${missed.map(weekday).join(", ")}.` : "",
    streak >= 2 ? `Current streak: ${streak} days${done.has(window.at(-1)!) ? "" : " up to yesterday"}.` : ""];
  return say(parts.filter(Boolean).join(" "));
}

// ---- bedtime ----
type LifeConfig = Record<string, unknown>;
// The file scripts/lib/life/config.mjs resolves (W10-B review 4: the gate saw this write the LIVE file mid-evaluation): ORION_LIFE_CONFIG,
// else eval-life-config.json while a sandboxed evaluation is live (eval-mode marker + fresh eval-calendar.json), else life-config.json.
const configFile = (stateDir: string) => process.env.ORION_LIFE_CONFIG
  || join(stateDir, `${sandboxNowMs({ dir: stateDir }) !== null ? "eval-" : ""}life-config.json`);
const readConfig = (stateDir: string): LifeConfig => { try { return JSON.parse(readFileSync(configFile(stateDir), "utf8")) as LifeConfig; } catch { return {}; } };
const DEFAULT_BEDTIME = "00:00";   // scripts/lib/life/config.mjs DEFAULTS.bedtime
const minutesOf = (t: string) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const fromMinutes = (n: number) => `${pad(Math.floor(((n % 1440) + 1440) % 1440 / 60))}:${pad(((n % 60) + 60) % 60)}`;
const validTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** 30 minutes earlier than now, never into the afternoon (a bedtime before 10 PM is his to name). */
export function earlierBedtime(current: string): string {
  const base = minutesOf(current) < 12 * 60 ? minutesOf(current) + 1440 : minutesOf(current);
  return fromMinutes(Math.max(22 * 60, base - 30));
}

export async function runBedtime(read: BedtimeRead, deps: { stateDir: string }): Promise<FlowResult> {
  const config = readConfig(deps.stateDir);
  const current = validTime(config.bedtime) ? config.bedtime : DEFAULT_BEDTIME;
  const windDown = Number.isInteger(config.windDownMinutes) ? Number(config.windDownMinutes) : 30;
  const reads = (t: string) => `wind-down starts ${hhmm12(fromMinutes(minutesOf(t) - windDown))}`;
  if (read.read) return { outcome: "say", kind: "plain", text: `Your bedtime is ${hhmm12(current)}; ${reads(current)}.`, calls: ["read life-config.json bedtime"], outputs: [current] };
  const target = read.time ?? earlierBedtime(current);
  if (!validTime(target)) return { outcome: "say", kind: "plain", text: "I couldn't read that bedtime, so it's still " + hhmm12(current) + "." };
  if (target === current) return { outcome: "say", kind: "plain", text: `Your bedtime is already ${hhmm12(current)}; ${reads(current)}. Tell me a different time if you want it earlier.`, calls: ["read life-config.json bedtime"], outputs: [current] };
  try {
    mkdirSync(deps.stateDir, { recursive: true });
    const tmp = `${configFile(deps.stateDir)}.tmp-${randomUUID().slice(0, 8)}`;
    writeFileSync(tmp, JSON.stringify({ ...config, bedtime: target }, null, 2));
    renameSync(tmp, configFile(deps.stateDir));
  } catch {
    return { outcome: "say", kind: "plain", text: `I couldn't save the new bedtime, so it's still ${hhmm12(current)}.` };
  }
  const assumed = read.time ? "" : ` I picked 30 minutes earlier since you didn't name a time; say a time if you want another.`;
  const scope = read.week ? ` I can't time-limit it, so it stays until you change it; say "bedtime back to ${hhmm12(current)}" to revert.` : "";
  return { outcome: "done", calls: [`write life-config.json bedtime ${target}`], outputs: [JSON.stringify({ bedtime: target, was: current })], reply: `Bedtime is now ${hhmm12(target)} (was ${hhmm12(current)}); ${reads(target)}.${assumed}${scope}` };
}

// ---- sleep, for a lightened day ----
/** "Your health log has 4.5 h of sleep and 31% recovery for last night." from the newest record of today or yesterday; "" when none. */
export async function sleepLine(stateDir: string, now: Date): Promise<string> {
  const log = await readHealthLog(join(stateDir, "health-log.json")).catch(() => undefined);
  const keys = [dayKey(now), dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))];
  const rec = keys.map((k) => log?.days?.[k]).find((r) => typeof r?.sleepHours === "number");
  if (!rec || typeof rec.sleepHours !== "number") return "";
  const hours = `${Math.round(rec.sleepHours * 10) / 10} h of sleep`;
  return `Your health log has ${hours}${typeof rec.recovery === "number" ? ` and ${Math.round(rec.recovery)}% recovery` : ""} for last night.`;
}

/** Runs one health read. */
export async function runHealthIntent(read: HealthRead, deps: { stateDir: string; now: Date }): Promise<FlowResult> {
  return read.kind === "waterlog" || read.kind === "intake" ? runIntake(read, deps) : read.kind === "water" ? runWaterGoal(read, deps) : read.kind === "meal" ? runMeal(read, deps) : read.kind === "gym" ? runGym(read, deps) : runBedtime(read, deps);
}
