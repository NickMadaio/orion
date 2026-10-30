/*
 Reality statements change the plan (2026-10-30).

 "Just note that I don't have classes. I still have my lab to do, but I don't have classes." (voice, 10:32) and
 "i dont have classes today" (13:32) changed nothing: the first hit the Ollama outage, neither had a handler, and three
 leave nudges for MKTG2201 went out afterwards. A reality statement is not a request with a calendar verb, so the
 schedule flow never owned it; the fact went nowhere.

 Code owns them now, with no model in the loop (so they work when Ollama is down):
   no classes / lecture's cancelled / no marketing and no macro today   declared fact no-classes (or skip per class) +
                                                                       orion-reschedule classes-off: marked cancelled,
                                                                       never deleted, one undo
   i didnt go to the gym / didnt make it to marketing / i skipped X     declared skip fact; a movable block that started
                                                                       leaves its slot and the day is re-weighed (displace)
   im doing X instead of Y / i did X instead of Y                       declared skip fact for Y; X replaces Y on the
                                                                       calendar (log --instead) and the rest is re-weighed
   i ate already / im at the library                                   declared ate / place fact
 Each reply is built here from what the scripts printed, says exactly what changed, and says how to undo it.
 The fact is written first through scripts/orion-declare (the declared-facts.json contract the now record and the class
 ladder read: the ladder is what cancels the leave nudges).
*/
import type { Day, DayBlock, FlowResult } from "./schedule-flow.js";

export type Reality =
  | { kind: "no-classes"; names: string[]; keep?: string; tomorrow: boolean; fill: boolean }
  | { kind: "missed"; what: string }
  | { kind: "instead"; did: string; planned?: string; past: boolean }
  | { kind: "ate" }
  | { kind: "place"; place: string };
/** A reality statement plus whether he also asked for another change in the same breath ("..., put catch-up on it tomorrow"). */
export type RealityRead = { reality: Reality; rest: boolean };

export type ScriptRun = (script: "orion-declare" | "orion-reschedule", args: string[]) => Promise<{ stdout: string; code: number }>;
export type RealityDeps = { run: ScriptRun; readDay: () => Promise<Day | undefined>; now: Date; source: string; text: string;
  /** How many times this kind or title slipped in the last 7 days (the state card), for "that's the fourth gym skip this week". */
  slipsOf?: (what: string) => number };
/** What a reality turn did: the reply, the declared fact ids and how many calendar writes (each is one orion-reschedule undo). */
export type RealityOutcome = { flow: FlowResult; facts: string[]; writes: number };

const clean = (m: string) => m.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
const QUESTION = /\?\s*$|^(?:(?:so|ok|hey|orion|wait)[,\s]+)*(?:do|did|does|is|are|am|was|were|have|has|will|should|can|could|what|when|why|how)\b/i;
// Not a fact about his day: a condition, a wish, or someone else's ("she didnt go to the gym").
const NOT_ME = /\b(?:if|unless|wish|hope|maybe|might|whether|pretend|imagine|what if|she|he|mom|mum|dad|my (?:friend|roommate|flatmate|sister|brother))\b/i;
// "cancel the leave reminders" is what the fact already does, not another change.
const REMINDERS_OFF = /\b(?:cancel|stop|turn off|no more)\s+(?:the\s+|my\s+|all\s+)?(?:leave\s+|class\s+)?(?:reminders?|nudges?|alerts?|notifications?|pings?)\b/gi;
const CLASS_WORD = "(?:class(?:es)?|lectures?|seminars?|tutorials?|recitations?)";
const GENERIC_NO = new RegExp(`\\b(?:no|don'?t have(?: any)?|dont have(?: any)?|do not have(?: any)?|haven'?t got(?: any)?|there(?:'s| is| are) no)\\s+(?:more\\s+)?${CLASS_WORD}\\b(?!\\s+(?:until|till|til|before|after|for)\\b)`, "i");
const CANCELLED = /\b([a-z0-9']+?)(?:'s|\s+is|\s+are|\s+was|\s+got|\s+has been|\s+have been|'re)\s+(?:been\s+)?(?:cancell?ed|canceled|called off)\b/i;
const BOTH_CANCELLED = /\b(?:both|they)(?:'re|\s+are|\s+were|\s+got)?\s+(?:both\s+)?cancell?ed\b/i;
const NAMED_NO = /\b(?:no|don'?t have|dont have|do not have)\s+([a-z0-9]+)(?:\s+(?:and|or)\s+(?:no\s+)?([a-z0-9]+))?\s+(?:class(?:es)?\s+|lectures?\s+)?(?:today|tomorrow|tmrw)\b/i;
const KEEP = /\bi (?:still|do) have (?:my |the |a )?([a-z0-9]+)/i;
const FILL = /\b(?:use (?:the|that) time|fill (?:the|that|my) (?:time|gaps?|day)|plan (?:the|my) (?:free )?time)\b/i;
const OTHER_CHANGE = /\b(?:put|add|book|schedule|reschedule|move|push|pull|swap|plan|remind|cancel the|delete|drop|extend|shorten|make it (?:an?|\d|longer|shorter|later|earlier))\b/i;
const NOT_A_NAME = new Set(["class", "classes", "lecture", "lectures", "time", "idea", "plans", "plan", "way", "one", "clue", "reason", "need", "school", "work", "more", "the", "my", "any", "gym", "both", "they", "it", "all", "that", "this", "everything", "anything"]);
const MISSED = /\b(?:i\s+)?(?:didn'?t|didnt|did not|never)\s+(?:go|make it|get|went)\s+(?:to\s+)?(?:the\s+|my\s+)?([a-z0-9][a-z0-9 ]{1,30}?)(?=\s*(?:today|this morning|this afternoon|tonight|earlier|lol|tbh|btw|[,.!]|$))/i;
const SKIPPED = /^(?:(?:so|ok|yeah|ya|btw|fyi|honestly|ugh)[,\s]+)*(?:i\s+)?(?:skipped|missed|bailed on|ditched)\s+(?:the\s+|my\s+)?([a-z0-9][a-z0-9 ]{1,30}?)(?=\s*(?:today|this morning|this afternoon|tonight|earlier|lol|tbh|btw|[,.!]|$))/i;
const INSTEAD_NOW = /\b(?:i'?m|im|i am)\s+(?:doing|working on|studying|at|going to|gonna do|just doing)\s+(?:the\s+|my\s+|some\s+)?(.+?)\s+instead(?:\s+of\s+(?:the\s+|my\s+)?(.+?))?\s*(?:right now|rn|now)?\s*[.!]*$/i;
const INSTEAD_PAST = /\b(?:i\s+)?(?:did|went to|went|worked on|studied|had|ended up doing)\s+(?:the\s+|my\s+|some\s+)?(.+?)\s+instead\s+of\s+(?:the\s+|my\s+)?(.+?)\s*[.!]*$/i;
const ATE = /^(?:(?:ok|so|yeah|ya|btw|fyi|just|already)[,\s]+)*(?:i\s+)?(?:already\s+|just\s+)?(?:ate|eaten|had (?:lunch|dinner|breakfast|food|something to eat))\b|^(?:i'?ve|ive)\s+(?:already\s+|just\s+)?(?:eaten|had (?:lunch|dinner|breakfast|food))\b|\bate already\b/i;
const PLACE = /^(?:(?:ok|so|fyi|btw|hey|orion|yeah)[,\s]+)*(?:i'?m|im|i am)\s+(?:at|in)\s+(?:the\s+)?(library|gym|home|campus|uni|university|school|office|work|cafe|coffee shop|[a-z]+'s(?: place| house| flat)?)\s*(?:now|rn|right now|already)?\s*[.!]*$/i;

/** He told ORION something that happened (or is happening), not asked for a change. Null when it is not one. */
export function readReality(message: string): RealityRead | null {
  const m = clean(message);
  if (!m || QUESTION.test(m) || NOT_ME.test(m.replace(/\bi still have\b.*$/, ""))) return null;
  const rest = OTHER_CHANGE.test(m.replace(REMINDERS_OFF, "").replace(/\bcancell?ed\b/g, ""));
  const tomorrow = /\b(?:tomorrow|tmrw)\b/.test(m);
  const named = NAMED_NO.exec(m); const cancelled = CANCELLED.exec(m);
  const names = [named?.[1], named?.[2], cancelled?.[1]].filter((w): w is string => !!w && !NOT_A_NAME.has(w) && !new RegExp(`^${CLASS_WORD}$`).test(w));
  if (GENERIC_NO.test(m) || names.length || (BOTH_CANCELLED.test(m) && names.length) || (cancelled && new RegExp(`^${CLASS_WORD}$`).test(cancelled[1] ?? ""))) {
    const keep = KEEP.exec(m)?.[1];
    return { reality: { kind: "no-classes", names: GENERIC_NO.test(m) && !names.length ? [] : [...new Set(names)], ...(keep ? { keep } : {}), tomorrow, fill: FILL.test(m) }, rest: rest && !FILL.test(m) };
  }
  const past = INSTEAD_PAST.exec(m); const present = INSTEAD_NOW.exec(m);
  if (present) return { reality: { kind: "instead", did: present[1]!.trim(), ...(present[2] ? { planned: present[2].trim() } : {}), past: false }, rest };
  if (past) return { reality: { kind: "instead", did: past[1]!.trim(), planned: past[2]!.trim(), past: true }, rest };
  const missed = MISSED.exec(m) ?? SKIPPED.exec(m);
  if (missed && !/\b(?:sleep|bed|enough|it|that|this|there|home|much|far|anything|everything)\b/.test(missed[1] ?? "")) return { reality: { kind: "missed", what: missed[1]!.trim() }, rest };
  if (ATE.test(m)) return { reality: { kind: "ate" }, rest };
  const place = PLACE.exec(m);
  if (place) return { reality: { kind: "place", place: place[1]! }, rest };
  return null;
}

// ---- matching his words against the day ----
const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** "macro" names "ECON1115 Principles of Macroeconomics", "marketing" names "MKTG2201 Introduction to Marketing". */
export function names(word: string, title: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (w.length < 2) return false;
  return words(title).some((t) => t === w || (w.length >= 3 && t.startsWith(w)) || (t.length >= 4 && w.startsWith(t)) || (/^[a-z]+\d+$/.test(t) && t.startsWith(w) && w.length >= 2));
}
const matchBlock = (what: string, blocks: DayBlock[]) => {
  const ws = words(what).filter((w) => w.length >= 2 && !["the", "my", "a", "to", "of"].includes(w));
  return blocks.filter((b) => ws.length && ws.every((w) => names(w, b.title)))[0] ?? blocks.filter((b) => ws.some((w) => w.length >= 3 && names(w, b.title)))[0];
};
/** "MKTG2201" for "MKTG2201 Introduction to Marketing — Lecture", the title otherwise. */
export const shortTitle = (title: string) => { const code = /^[A-Z]{2,5}\d{3,5}\b/.exec(title)?.[0]; return code ?? title.split(/\s+[—–-]\s+/)[0]!.trim(); };
const minuteOf = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const ampm = (t: string) => { const v = minuteOf(t); const h = Math.floor(v / 60); return `${(h + 11) % 12 + 1}:${String(v % 60).padStart(2, "0")} ${h < 12 || h >= 24 ? "AM" : "PM"}`; };
const listed = (items: string[]) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const ORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

const UNDO = "Say \"undo\" to put it back.";
export const REALITY_SAVE_FAILED = "I couldn't save that just now, so nothing changed. Say it again in a moment.";

async function declare(deps: RealityDeps, kind: string, extra: string[] = []): Promise<string | null> {
  const out = await deps.run("orion-declare", ["add", "--kind", kind, "--text", deps.text.slice(0, 200), "--source", deps.source, ...extra]).catch(() => ({ stdout: "", code: 1 }));
  try { const fact = JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "") as { id?: unknown }; return out.code === 0 && typeof fact.id === "string" ? fact.id : null; } catch { return null; }
}
const say = (text: string, calls: string[] = [], outputs: string[] = []): FlowResult => ({ outcome: "say", kind: "plain", text, calls, outputs });
const done = (reply: string, calls: string[], outputs: string[]): FlowResult => ({ outcome: "done", calls, outputs, reply });
const canon = (args: string[]) => args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
/** The "Changed …:" lines a script printed, as plain clauses ("moved Study: 18:00 → 19:00"). */
const changeLines = (stdout: string) => stdout.split("\n").map((l) => l.trim()).filter((l) => /^(?:moved|bumped|re-entered|logged)\b/.test(l) || / has no room today$/.test(l));
const clause = (l: string) => l.replace(/(\d{1,2}:\d{2})/g, (t) => ampm(t)).replace(/ \(([^)]*)\): lower weight than what it made room for/, " to make room");

async function noClasses(r: Extract<Reality, { kind: "no-classes" }>, deps: RealityDeps): Promise<RealityOutcome | null> {
  const day = await deps.readDay().catch(() => undefined);
  const classes = (day?.blocks ?? []).filter((b) => b.kind === "class");
  const named = r.names.length ? classes.filter((b) => r.names.some((n) => names(n, b.title))) : [];
  // Named words that are no class on that day ("no gym today") are not this statement: the turn goes on as usual.
  if (r.names.length && day && !named.length) return null;
  const facts = (r.names.length ? await Promise.all(named.map((b) => declare(deps, "skip", ["--title", b.title, ...(r.tomorrow ? ["--date", dateOf(day, deps.now, 1)] : [])])))
    : [await declare(deps, "no-classes", r.tomorrow ? ["--date", dateOf(day, deps.now, 1)] : [])]).filter((id): id is string => !!id);
  if (!facts.length) return { flow: say(REALITY_SAVE_FAILED), facts, writes: 0 };
  const args = ["classes-off", ...(r.names.length ? named.map((b) => shortTitle(b.title)) : []), ...(r.keep ? ["--keep", r.keep] : []), ...(r.tomorrow ? ["--date", "tomorrow"] : [])];
  const off = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
  const calls = [`exec orion-reschedule ${canon(args)}`]; const outputs = [off.stdout];
  const day0 = r.tomorrow ? "tomorrow" : "today";
  const cancelled = [...off.stdout.matchAll(/cancelled (.+?) (\d{2}:\d{2})–\d{2}:\d{2}/g)].map((x) => `${shortTitle(x[1]!)} (${ampm(x[2]!)})`);
  const kept = r.keep ? classes.filter((b) => names(r.keep!, b.title)).map((b) => shortTitle(b.title)) : [];
  const keptLine = kept.length ? ` ${listed(kept)} is still on.` : r.keep ? ` Your ${r.keep} is still on.` : "";
  if (off.code !== 0) return { flow: say(`I've noted no classes ${day0}, so there'll be no leave reminders for them, but I couldn't mark them off your calendar just now.${keptLine}`, calls, outputs), facts, writes: 0 };
  if (!cancelled.length) return { flow: say(`Noted: no classes ${day0}. There weren't any on your calendar to cancel.${keptLine}`, calls, outputs), facts, writes: 0 };
  let reply = `Got it, no ${r.names.length ? listed(cancelled.map((c) => c.split(" (")[0]!)) : "classes"} ${day0}. I've marked ${listed(cancelled)} cancelled (still in Apple Calendar), so no leave reminders for ${cancelled.length > 1 ? "them" : "it"}.${keptLine}`;
  let writes = 1;
  if (r.fill && !r.tomorrow) {
    const fill = await deps.run("orion-reschedule", ["fill"]).catch(() => ({ stdout: "", code: 1 }));
    calls.push("exec orion-reschedule fill"); outputs.push(fill.stdout);
    const placed = fill.stdout.split("\n").map((l) => l.trim()).filter((l) => /^(?:added|placed|booked|\+)/i.test(l) || /\d{2}:\d{2}–\d{2}:\d{2}/.test(l)).slice(0, 4);
    if (fill.code === 0 && !/NOTHING WAS/.test(fill.stdout)) { writes += 1; reply += placed.length ? ` In the free time: ${placed.map(clause).join("; ")}.` : " I filled the free time."; }
    else reply += " I couldn't fill the free time just now.";
  }
  return { flow: done(`${reply} Say "undo" to put ${cancelled.length > 1 ? "them" : "it"} back.`, calls, outputs), facts, writes };
}
const dateOf = (day: Day | undefined, now: Date, plus: number) => {
  const d = new Date(now.getTime() + plus * 86400_000);
  return day?.date && plus === 0 ? day.date : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function missed(r: Extract<Reality, { kind: "missed" }>, deps: RealityDeps): Promise<RealityOutcome> {
  const day = await deps.readDay().catch(() => undefined);
  const block = matchBlock(r.what, day?.blocks ?? []);
  const title = block?.title ?? r.what;
  const id = await declare(deps, "skip", ["--title", title]);
  if (!id) return { flow: say(REALITY_SAVE_FAILED), facts: [], writes: 0 };
  const count = (deps.slipsOf?.(block?.kind ?? r.what) ?? 0) + 1;
  const pattern = count >= 3 ? ` That's the ${ORD[count] ?? `${count}th`} ${block?.kind === "gym" || /gym/i.test(title) ? "gym " : ""}skip this week.` : "";
  const now = deps.now.getHours() * 60 + deps.now.getMinutes();
  if (!block) return { flow: say(`Noted: no ${r.what} today. It isn't on your calendar, so nothing there changed.${pattern}`), facts: [id], writes: 0 };
  if (block.fixed) return { flow: say(`Noted: you missed ${shortTitle(title)} today, so I won't count it as attended.${pattern} If you want catch-up time for it, tell me when.`), facts: [id], writes: 0 };
  if (minuteOf(block.start) > now) {
    const args = ["drop", block.title];
    const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
    const ok = out.code === 0 && !/NOTHING WAS/.test(out.stdout);
    return { flow: ok ? done(`Okay, ${shortTitle(title)} is off today; I took the ${ampm(block.start)} block off your calendar.${pattern} ${UNDO}`, [`exec orion-reschedule ${canon(args)}`], [out.stdout])
      : say(`Noted: no ${shortTitle(title)} today, but I couldn't take its ${ampm(block.start)} block off your calendar.${pattern}`, [`exec orion-reschedule ${canon(args)}`], [out.stdout]), facts: [id], writes: ok ? 1 : 0 };
  }
  const args = ["displace", block.title, "--why", "skip"];
  const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
  const ok = out.code === 0 && !/NOTHING WAS/.test(out.stdout);
  const moved = changeLines(out.stdout).map(clause);
  return { flow: ok ? done(`Okay, ${shortTitle(title)} didn't happen; it's off its ${ampm(block.start)} slot${moved.length ? ` and I re-weighed the rest: ${moved.join("; ")}` : ""}.${pattern} ${UNDO}`, [`exec orion-reschedule ${canon(args)}`], [out.stdout])
    : say(`Noted: ${shortTitle(title)} didn't happen, but I couldn't take it off your calendar just now.${pattern}`, [`exec orion-reschedule ${canon(args)}`], [out.stdout]), facts: [id], writes: ok ? 1 : 0 };
}

async function instead(r: Extract<Reality, { kind: "instead" }>, deps: RealityDeps): Promise<RealityOutcome | null> {
  const day = await deps.readDay().catch(() => undefined);
  if (!day) return { flow: say("I couldn't read your calendar just now, so nothing changed. Tell me again in a moment."), facts: [], writes: 0 };
  const now = deps.now.getHours() * 60 + deps.now.getMinutes();
  const current = day.blocks.filter((b) => b.kind !== "commute" && minuteOf(b.start) <= now && now < minuteOf(b.end))[0];
  const planned = r.planned ? matchBlock(r.planned, day.blocks) : current;
  if (!planned) return r.planned ? { flow: say(`${r.planned} isn't on your calendar today, so there was nothing to replace. Nothing changed.`), facts: [], writes: 0 } : null;
  const id = await declare(deps, "skip", ["--title", planned.title]);
  if (!id) return { flow: say(REALITY_SAVE_FAILED), facts: [], writes: 0 };
  const [ps, pe] = [minuteOf(planned.start), minuteOf(planned.end)];
  // Past: he did X in Y's slot. Now: X from Y's start (or now, when Y is still ahead) for Y's length; log takes up to 3 h ahead.
  const from = r.past || ps <= now ? ps : now;
  const to = Math.min(r.past ? Math.min(pe, now) : from + (pe - ps), now + 180);
  if (to - from < 5) return { flow: say(`Noted that you're doing ${r.did} instead of ${shortTitle(planned.title)}, but ${shortTitle(planned.title)} hasn't started, so I left the calendar alone.`), facts: [id], writes: 0 };
  const calls: string[] = []; const outputs: string[] = []; let writes = 0;
  if (planned.fixed && planned.kind === "class") {
    const off = await deps.run("orion-reschedule", ["classes-off", shortTitle(planned.title)]).catch(() => ({ stdout: "", code: 1 }));
    calls.push(`exec orion-reschedule classes-off ${shortTitle(planned.title)}`); outputs.push(off.stdout);
    if (off.code === 0 && /cancelled/.test(off.stdout)) writes += 1;
  }
  const args = ["log", r.did, "--from", hhmm(from), "--to", hhmm(to), ...(planned.fixed ? [] : ["--instead", planned.title])];
  const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
  calls.push(`exec orion-reschedule ${canon(args)}`); outputs.push(out.stdout);
  const ok = out.code === 0 && !/NOTHING WAS/.test(out.stdout);
  if (!ok) {
    const why = /NOTHING WAS CHANGED: (.+)/.exec(out.stdout)?.[1]?.replace(/\.$/, "");
    return { flow: say(`I couldn't put ${r.did} in place of ${shortTitle(planned.title)}${why ? ` (${why.replace(/(\d{2}:\d{2})/g, (t) => ampm(t))})` : ""}, so your calendar is as it was${writes ? `, apart from marking ${shortTitle(planned.title)} cancelled. ${UNDO}` : "."}`, calls, outputs), facts: [id], writes };
  }
  writes += 1;
  const moved = changeLines(out.stdout).filter((l) => !/^logged\b/.test(l)).map(clause);
  return { flow: done(`Done: ${r.did} ${ampm(hhmm(from))}–${ampm(hhmm(to))} is on your calendar in place of ${shortTitle(planned.title)}${moved.length ? `, and the rest of today is re-weighed: ${moved.join("; ")}` : ""}. ${UNDO}`, calls, outputs), facts: [id], writes };
}

async function noted(r: Extract<Reality, { kind: "ate" | "place" }>, deps: RealityDeps, next?: string): Promise<RealityOutcome> {
  const id = await declare(deps, r.kind, r.kind === "place" ? ["--place", r.place] : []);
  if (!id) return { flow: say(REALITY_SAVE_FAILED), facts: [], writes: 0 };
  const text = r.kind === "ate" ? "Good, noted you've eaten. I won't chase you about food." : `Got it, you're at ${/^(home|work|campus|uni|school)$/.test(r.place) ? r.place : `the ${r.place}`}.`;
  return { flow: say(`${text}${next ? ` ${next}` : ""}`), facts: [id], writes: 0 };
}

/** Carries out what he said, with no model. Null: the words were not a reality statement after all (the turn goes on). */
export async function runReality(read: RealityRead, deps: RealityDeps & { next?: string }): Promise<RealityOutcome | null> {
  const r = read.reality;
  if (r.kind === "no-classes") return noClasses(r, deps);
  if (r.kind === "missed") return missed(r, deps);
  if (r.kind === "instead") return instead(r, deps);
  return noted(r, deps, deps.next);
}

/** Only the fact, for a statement that also asks for another change ("i skipped marketing, put catch-up tomorrow"): the change goes on as usual. */
export async function declareOnly(read: RealityRead, deps: RealityDeps): Promise<string | null> {
  const r = read.reality;
  if (r.kind === "no-classes" && !r.names.length) return declare(deps, "no-classes");
  if (r.kind === "missed") return declare(deps, "skip", ["--title", r.what]);
  if (r.kind === "ate") return declare(deps, "ate");
  if (r.kind === "place") return declare(deps, "place", ["--place", r.place]);
  return null;
}

/** "undo" right after a reality turn: every calendar write it made comes back, and the facts it declared are taken back. */
export async function undoReality(last: { facts: string[]; writes: number }, run: ScriptRun): Promise<FlowResult> {
  const calls: string[] = []; const outputs: string[] = [];
  for (let i = 0; i < last.writes; i += 1) {
    const out = await run("orion-reschedule", ["undo"]).catch(() => ({ stdout: "", code: 1 }));
    calls.push("exec orion-reschedule undo"); outputs.push(out.stdout);
    if (out.code !== 0) return say("I couldn't undo all of that just now. Check your calendar, and tell me what's wrong.", calls, outputs);
  }
  for (const id of last.facts) { const out = await run("orion-declare", ["remove", "--id", id]).catch(() => ({ stdout: "", code: 1 })); calls.push(`exec orion-declare remove --id ${id}`); outputs.push(out.stdout); }
  const restored = outputs.flatMap((o) => [...o.matchAll(/put (.+?) back/g)].map((x) => shortTitle(x[1]!)));
  return done(`Undone${restored.length ? `: ${listed([...new Set(restored)])} ${restored.length > 1 ? "are" : "is"} back on your plan` : ""}, and I've forgotten what you told me about it.`, calls, outputs);
}
