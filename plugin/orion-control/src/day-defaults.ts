/*
 Defaults instead of a clarifier, and "what now" from the real day (2026-10-31, gate run-1031202318 clusters 6 and 7).

 "tmrw needs to be chill" got "I'll keep tomorrow light. What's the one thing to skip?" and nothing changed; "annika just asked
 if i wanna get food rn" got "What are you thinking of grabbing?"; "throw in something before my class" got a study block at
 6:37 PM, hours after the class; "thanks, what do i do now" got "You're all caught up. Go get some rest." with gym still ahead,
 and a stale "Next: CS2100 at 9:00 AM" was never corrected.

 Each of these has a safe default, so code acts and says the assumption in one clause:
   lighten       a day he wants easy: optional chores come off, the side project goes to 30 minutes only when nothing else could,
                 an hour of rest goes in. Classes, gym, study and plans with people are never touched.
   with-person   someone asked him out now: about two hours from now is held (orion-reschedule busy), ORION's own blocks slide out
                 of it. The plan itself is not booked: he named no times.
   before-class  "something before my class": 30 minutes ending a buffer before the class, in time that is already free.
   whats-now     what is under way or next, from the calendar, with times; never "all caught up" over a day that is not.
   ack-claim     "ok" to ORION's own "Next: X at T": checked against the calendar and corrected when it was wrong.
 Anything destructive, or a class or a person's plan he did not name, is never a default (those stay with the schedule flow).
*/
import { meansTomorrow, type Day, type DayBlock, type FlowResult } from "./schedule-flow.js";
import type { DeadlineRead } from "./deadline-read.js";
import type { ScriptRun } from "./reality.js";
import { soonDeadlines } from "./day-lighten.js";
import { ampm, ceil5, hhmm, span, toMin } from "./intent-time.js";
import { notBooked, refused, sideNotes, wrote } from "./scheduler-out.js";
import { blocksNamedBy } from "./block-names.js";

type Claim = { title: string; at: string };
export type DayDefault =
  | { kind: "lighten"; tomorrow: boolean }
  | { kind: "with-person"; who: string; what: string; hedged?: boolean }
  | { kind: "before-class"; title: string; minutes: number; named?: string; quick?: boolean }
  | { kind: "whats-now"; claim?: Claim }
  | { kind: "ack-claim"; claim: Claim };
export type DefaultDeps = { run: ScriptRun; readDay: (dateArgs: string[]) => Promise<Day | undefined>; now: Date; deadlines?: () => Promise<DeadlineRead | null | undefined> };
export type DefaultOutcome = { flow: FlowResult; writes: number; reads: string[] };

// ---- reading ----
const STATED = /\d|\b(?:noon|midnight|half an? hour|an hour|hours?)\b/i;
const OTHER_JOB = /\b(?:remind|reminder|alarm|timer|text|message|email|call|tell)\b/i;
const ASKS_ABOUT = /^(?:is|was|will|are|how|what|whats|what's|when|does|did)\b|\b(?:was|were|wasn'?t)\b|\b(?:doesn'?t|don'?t|dont) (?:need|have) to\b/i;

const DAY_WORD = /\b(?:tomorrow|tmrw|tmr|tmrow|tomorow|tommorow|tmw|today|tonight|this evening|rest of (?:the|my) day)\b/i;
const TOMORROW = /\b(?:tomorrow|tmrw|tmr|tmrow|tomorow|tommorow|tmw)\b/i;
const CHILL = /\b(?:chill(?:ed)?|light(?:er)?|easy|easier|relaxed|relaxing|low[- ]?key|calm(?:er)?|lazy|gentle|recovery day|rest day|not (?:too |so )?(?:packed|busy|full|heavy|crazy|hectic)|less (?:packed|busy|full|heavy|hectic))\b/i;
const WANTS = /\b(?:needs? to be|has to be|have to be|gotta be|should be|must be|make|keep|want|need|wanna|give me|can (?:we|you|u)|let'?s|lets|plan)\b/i;
const SPECIFIC = /\b(?:cut|drop|add|move|shorten|resize|remove|cancel|skip|swap|push|clear|delete|book|put)\b/i;

const FOOD = /\b(?:food|eat|dinner|lunch|brunch|breakfast|coffee|drinks?|a drink|pizza|boba|a bite|bite to eat|hang(?:ing)? out|go out|going out)\b/i;
const NOWISH = /\b(?:rn|right now|now|asap|in a (?:bit|sec|few)|right away)\b/i;
const ASKED_ME = /\b([a-z]+)\s+(?:just\s+)?(?:asked|invited|wants|wanted|is asking|was asking|texted|messaged|is down|wanna)\b/i;
const WITH = /\bwith\s+(?:my\s+)?([a-z]+)\b/i;
const GROUP = /\b(?:my\s+)?(friends|mates|roommates?|flatmates?|housemates?|the boys|the girls|the group)\b/i;
const NOT_WHO = new Set(["i", "im", "i'm", "it", "this", "that", "he", "she", "they", "someone", "somebody", "everyone", "who", "you", "u", "we", "just", "and", "so", "my", "me", "if", "she's", "he's", "theyre", "there"]);

/** Not a decision yet: asking, unsure, or still thinking. A hedge is a question back, never a hold on his calendar. */
const HEDGE = /\bidk\b|\bi don'?t know\b|\bmaybe\b|\bperhaps\b|\bshould i\b|\bthinking (?:about|of)\b|\bnot sure\b|\bunsure\b|\?/i;

const BEFORE_CLASS = /\bbefore\s+(?:my|the|this|today'?s)?\s*(?:next\s+|first\s+|afternoon\s+|morning\s+)?(?:([a-z]{2,5}\s?\d{3,4}|[a-z]+)\s+)?(?:class|lecture|lab|seminar|tutorial)\b|\bbefore\s+(?:my|the)\s+([a-z]{2,5}\s?\d{3,4})\b/i;
const PUT_IN = /\b(?:throw|put|add|fit|squeeze|sneak|slot|book|schedule|stick|cram|get|do|plan|pop|block)\b/i;
const STUDY_WORD: Array<[RegExp, string]> = [[/\breview/i, "Review"], [/\brevis/i, "Revision"], [/\bread(?:ing)?\b/i, "Reading"], [/\bprep/i, "Prep"], [/\bhomework\b/i, "Homework"], [/\bpractice\b/i, "Practice"], [/\bgo(?:ing)? over\b/i, "Review"], [/\bstud(?:y|ying)\b/i, "Study"], [/\b(?:something|work)\b/i, "Study"]];
const GENERIC_NAME = new Set(["next", "first", "afternoon", "morning", "my", "the", "this"]);

const LEAD = /^(?:(?:ok(?:ay)?|k|kk|so|thanks|thank you|thx|ty|cool|alright|aight|wait|hm+|um+|uh+|right|nice|great|orion|hey|yo|and|then)[,.!\s]+)*/i;
const TRAIL = /(?:\s+(?:actually|lol|lmao|tho|though|exactly|again|then))*\s*[?.!]*$/i;
const WHATS_NOW = /^(?:what(?:'s|s| is)?\s+(?:up\s+)?next|what\s+now|now\s+what|what\s+(?:do|should|shall|can)\s+i\s+(?:do|be doing|get on with|work on)|what\s+(?:am i|should i be)\s+(?:supposed to be\s+|meant to be\s+)?doing|what(?:'s| is|s)?\s+on\s+now)(?:\s+(?:now|next|rn|right now|then))*$/i;
const ACK = /^(?:ok(?:ay)?|k|kk|cool|got it|thanks|thank you|thx|ty|alright|sounds good|bet|yep|yeah|sure|nice|great|perfect)(?:[,\s]+(?:ok(?:ay)?|cool|got it|thanks|thank you|thx|ty|alright|sounds good|bet|nice|great|perfect))*[.!\s]*$/i;
const CLAIM = /\bNext:\s*(.+?)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?)/;

const claimOf = (outreach?: string): Claim | undefined => {
  const c = outreach ? CLAIM.exec(outreach) : null;
  return c ? { title: c[1]!.trim(), at: c[2]!.trim().replace(/\.$/, "") } : undefined;
};

function readWithPerson(m: string): DayDefault | null {
  if (!FOOD.test(m) || !NOWISH.test(m) || STATED.test(m) || OTHER_JOB.test(m)) return null;
  const asked = ASKED_ME.exec(m)?.[1]; const withWho = WITH.exec(m)?.[1]; const group = GROUP.exec(m)?.[1];
  const who = [group, asked, withWho].find((w): w is string => !!w && !NOT_WHO.has(w.toLowerCase()) && !FOOD.test(w));
  if (!who) return null;
  const what = (FOOD.exec(m)?.[0] ?? "food").toLowerCase().replace(/^(?:eat|a bite|bite to eat)$/, "food").replace(/^(?:go(?:ing)? out|hang(?:ing)? out)$/, "plans");
  return { kind: "with-person", who: who.toLowerCase(), what, ...(HEDGE.test(m) ? { hedged: true } : {}) };
}

function readBeforeClass(m: string): DayDefault | null {
  const b = BEFORE_CLASS.exec(m);
  if (!b || !PUT_IN.test(m) || STATED.test(m) || ASKS_ABOUT.test(m)) return null;
  const thing = STUDY_WORD.find(([re]) => re.test(m.slice(0, b.index)) || re.test(m));
  if (!thing) return null;
  const named = (b[1] ?? b[2])?.toLowerCase();
  return { kind: "before-class", title: thing[1], minutes: 30, ...(/\b(?:quick|short)\b/i.test(m) ? { quick: true } : {}), ...(named && !GENERIC_NAME.has(named) ? { named } : {}) };
}

/** A request with a safe default, or a "what now", or null (the turn goes on as before). outreach: the line ORION sent first, if any. */
export function readDayDefault(message: string, outreach?: string, now: Date = new Date()): DayDefault | null {
  const m = message.trim();
  if (!m) return null;
  const claim = claimOf(outreach);
  if (claim && ACK.test(m)) return { kind: "ack-claim", claim };
  const core = m.toLowerCase().replace(LEAD, "").replace(TRAIL, "").trim();
  if (WHATS_NOW.test(core)) return { kind: "whats-now", ...(claim ? { claim } : {}) };
  if (DAY_WORD.test(m) && CHILL.test(m) && WANTS.test(m) && !SPECIFIC.test(m) && !STATED.test(m) && !ASKS_ABOUT.test(m) && !OTHER_JOB.test(m)) return { kind: "lighten", tomorrow: TOMORROW.test(m) && meansTomorrow("tmrw", now) };
  return readWithPerson(m) ?? readBeforeClass(m);
}

// ---- the day ----
const UNDO = "Say \"undo\" to put it back.";
const NO_DAY = "I couldn't read your calendar just now, so I haven't changed anything. Ask me again in a moment.";
const say = (text: string, kind: "plain" | "ask" = "plain", calls: string[] = [], outputs: string[] = []): FlowResult => ({ outcome: "say", kind, text, ...(calls.length ? { calls, outputs } : {}) });
const canon = (args: string[]) => `exec orion-reschedule ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`;
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const kindOf = (b: DayBlock): string => b.kind ?? (/\b(?:lecture|seminar|lab|class|tutorial)\b|\b[a-z]{2,5}\d{3,4}\b/i.test(b.title) ? "class" : /\bgym|workout/i.test(b.title) ? "gym" : "other");
const isClass = (b: DayBlock) => kindOf(b) === "class";
const minuteNow = (day: Day, now: Date) => (day.now ? toMin(day.now) : now.getHours() * 60 + now.getMinutes());
const listed = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
const spoken = (b: DayBlock) => span(toMin(b.start), toMin(b.end));
const LOW_OTHER = /\b(?:laundry|groceries|grocery|shopping|errands?|clean(?:ing)?|tidy(?:ing)?|chores?|games?|gaming|tv|netflix|admin|inbox|emails?|organi[sz]e|declutter)\b/i;
const WITH_PEOPLE = /\b(?:with|meet(?:ing|up)?)\b|\bw\//i;

/** "Gym moved: 17:00 → 18:35–20:05", the other way the scheduler says a block slid (sideNotes reads "moved Gym: a → b"). */
const movedLines = (stdout: string): string[] => stdout.split("\n").flatMap((l) => {
  const m = /^(.+?) moved: (\d{2}:\d{2}) → (\d{2}:\d{2})/.exec(l.trim());
  return m ? [`${m[1]} ${ampm(toMin(m[2]!))} → ${ampm(toMin(m[3]!))}`] : [];
});

/** The first free stretch of `minutes` between from and to, keeping the buffer around every block. */
function freeAt(blocks: DayBlock[], minutes: number, from: number, to: number, buffer: number): number | null {
  for (let s = ceil5(from); s + minutes <= to; s += 5) {
    if (blocks.every((b) => s + minutes + buffer <= toMin(b.start) || s >= toMin(b.end) + buffer)) return s;
  }
  return null;
}

async function lighten(d: Extract<DayDefault, { kind: "lighten" }>, deps: DefaultDeps): Promise<DefaultOutcome> {
  const reads = [d.tomorrow ? "day-tomorrow" : "day"];
  const day = await deps.readDay(d.tomorrow ? ["--date", "tomorrow"] : []).catch(() => undefined);
  if (!day) return { flow: say(NO_DAY), writes: 0, reads: [] };
  const from = d.tomorrow ? 0 : minuteNow(day, deps.now);
  const ahead = day.blocks.filter((b) => toMin(b.start) >= from);
  const movable = ahead.filter((b) => !b.fixed && !isClass(b) && !WITH_PEOPLE.test(b.title));
  const chores = movable.filter((b) => kindOf(b) === "other" && LOW_OTHER.test(b.title));
  const side = movable.find((b) => kindOf(b) === "side_project" && toMin(b.end) - toMin(b.start) > 30);
  const shrink = !chores.length && side ? side : undefined;
  const steps: Array<{ args: string[]; said: string }> = chores.map((b) => ({ args: ["drop", b.title], said: `${b.title} is off` }));
  if (shrink) steps.push({ args: ["resize", shrink.title, "30"], said: `${shrink.title} is down to 30 minutes` });
  const left = day.blocks.filter((b) => !chores.includes(b)).map((b) => (b === shrink ? { ...b, end: hhmm(toMin(b.start) + 30) } : b));
  const restAt = day.blocks.some((b) => /\b(?:rest|nap|break)\b/i.test(b.title)) ? null : freeAt(left, 60, Math.max(13 * 60, from + 5), 21 * 60 + 30, day.plan?.bufferMinutes ?? 5);
  if (restAt !== null) steps.push({ args: ["add", "Rest", "60", "--at", hhmm(restAt)], said: `an hour of rest at ${ampm(restAt)}` });
  const when = d.tomorrow ? "tomorrow" : "the rest of today";
  const kept = ahead.filter((b) => b.fixed || isClass(b) || kindOf(b) === "gym");
  const gym = kept.find((b) => kindOf(b) === "gym");
  const keptLine = `${gym ? `Gym stays at ${ampm(toMin(gym.start))}, 90 minutes` : "Gym isn't on it, so there was none to keep"}${kept.some(isClass) ? `, and ${listed([...new Set(kept.filter(isClass).map((b) => b.title))])} ${kept.filter(isClass).length > 1 ? "stay" : "stays"} as ${kept.filter(isClass).length > 1 ? "they are" : "it is"}` : ""}.`;
  const assume = `I took chill to mean less optional stuff, not fewer classes or less gym; tell me if you want something else gone.`;
  if (!steps.length) return { flow: say(`${when === "tomorrow" ? "Tomorrow" : "The rest of today"} is already about as light as it gets without touching classes, gym or study, so I left it. ${keptLine}`), writes: 0, reads };
  const calls: string[] = []; const outputs: string[] = []; const said: string[] = []; let writes = 0; let failed: string | undefined;
  for (const step of steps) {
    const args = [...step.args, "--date", day.date];
    const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
    calls.push(canon(args)); outputs.push(out.stdout);
    if (wrote(out)) writes += 1;
    if (refused(out) || (step.args[0] === "add" && notBooked(out.stdout, "Rest"))) { failed = step.said; continue; }
    said.push(step.said);
  }
  const also = sideNotes(said.join(" "), outputs);
  const text = said.length
    ? `Kept ${when} light: ${listed(said)}.${also.length ? ` Also: ${also.join("; ")}.` : ""}${failed ? ` I couldn't do the rest (${failed}).` : ""} ${keptLine} ${assume} ${UNDO}`
    : `I couldn't change ${when} just now, so it's as it was. ${keptLine}`;
  return { flow: writes ? { outcome: "done", calls, outputs, reply: text } : say(text, "plain", calls, outputs), writes, reads };
}

const PLAN_MINUTES = 120;
async function withPerson(d: Extract<DayDefault, { kind: "with-person" }>, deps: DefaultDeps): Promise<DefaultOutcome> {
  if (d.hedged) return { flow: say(`Do you want to go with ${d.who}? Say so and I'll clear about two hours for it; until then I haven't touched your day.`, "ask"), writes: 0, reads: [] };
  const day = await deps.readDay([]).catch(() => undefined);
  if (!day) return { flow: say(NO_DAY), writes: 0, reads: [] };
  const start = ceil5(minuteNow(day, deps.now)); const end = Math.min(start + PLAN_MINUTES, 23 * 60 + 55);
  const inWindow = (b: DayBlock) => toMin(b.start) < end && toMin(b.end) > start;
  const inWay = day.blocks.filter((b) => inWindow(b) && !b.fixed && !isClass(b) && kindOf(b) !== "commute");
  const fixed = day.blocks.filter((b) => inWindow(b) && (b.fixed || isClass(b)));
  const fixedLine = fixed.length ? ` ${listed(fixed.map((b) => `${b.title} at ${ampm(toMin(b.start))}`))} ${fixed.length > 1 ? "are" : "is"} in that time and ${fixed.length > 1 ? "stay" : "stays"} where ${fixed.length > 1 ? "they are" : "it is"}.` : "";
  const assume = `I'm assuming about two hours, until ${ampm(end)}`;
  if (!inWay.length) return { flow: say(`Go for it. ${assume}, and nothing of yours is in the way.${fixedLine} Tell me if it runs longer.`), writes: 0, reads: ["day"] };
  const args = ["busy", `${hhmm(start)}-${hhmm(end)}`, "--why", `${d.what} with ${d.who}`];
  const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
  const calls = [canon(args)];
  if (refused(out)) return { flow: say(`Go for it. I couldn't move ${listed(inWay.map((b) => b.title))} out of the way just now, so your plan is as it was; tell me when you're back and I'll fit it in.`, "plain", calls, [out.stdout]), writes: 0, reads: ["day"] };
  const moved = [...movedLines(out.stdout), ...sideNotes("", [out.stdout])];
  const text = `Go for it. ${assume}, so ${moved.length ? `I moved what was in the way: ${[...new Set(moved)].join("; ")}` : "I cleared that time for it"}.${fixedLine} Tell me if it runs longer. ${UNDO}`;
  return { flow: wrote(out) ? { outcome: "done", calls, outputs: [out.stdout], reply: text } : say(text, "plain", calls, [out.stdout]), writes: wrote(out) ? 1 : 0, reads: ["day"] };
}

async function beforeClass(d: Extract<DayDefault, { kind: "before-class" }>, deps: DefaultDeps): Promise<DefaultOutcome> {
  const day = await deps.readDay([]).catch(() => undefined);
  if (!day) return { flow: say(NO_DAY), writes: 0, reads: [] };
  const nowMin = minuteNow(day, deps.now);
  const upcoming = day.blocks.filter((b) => isClass(b) && toMin(b.start) > nowMin);
  const named = d.named ? upcoming.find((b) => norm(b.title).includes(norm(d.named!)) || norm(d.named!).replace(/\s/g, "") === norm(b.title).replace(/\s/g, "")) ?? blocksNamedBy(d.named, upcoming, { intent: "class" })[0] : undefined;
  const cls = named ?? upcoming[0];
  if (!cls) {
    const next = (await deps.readDay(["--date", "tomorrow"]).catch(() => undefined))?.blocks.find(isClass);
    return { flow: say(`There's no class left today to put it before${next ? `; your next one is ${next.title} tomorrow at ${ampm(toMin(next.start))}. Want it before that?` : ", so I haven't added anything."}`, next ? "ask" : "plain"), writes: 0, reads: ["day", "day-tomorrow"] };
  }
  const buffer = day.plan?.bufferMinutes ?? 5;
  const latest = toMin(cls.start) - buffer;
  const others = day.blocks.filter((b) => b !== cls);
  let at: number | null = null;
  for (let s = latest - d.minutes; s >= ceil5(nowMin + 5); s -= 5) {
    if (others.every((b) => s + d.minutes + buffer <= toMin(b.start) || s >= toMin(b.end) + buffer)) { at = s; break; }
  }
  const took = d.named && !named ? ` I took your class as ${cls.title}.` : "";
  if (at === null) return { flow: say(`There isn't a free ${d.minutes} minutes before ${cls.title} at ${ampm(toMin(cls.start))}, so I haven't added anything.${took} Want it right after instead?`, "ask"), writes: 0, reads: ["day"] };
  const args = ["add", d.title, String(d.minutes), "--at", hhmm(at), "--date", day.date];
  const out = await deps.run("orion-reschedule", args).catch(() => ({ stdout: "", code: 1 }));
  const calls = [canon(args)];
  if (refused(out) || notBooked(out.stdout, d.title)) return { flow: say(`I couldn't add ${d.title.toLowerCase()} before ${cls.title} just now, so nothing changed.`, "plain", calls, [out.stdout]), writes: wrote(out) ? 1 : 0, reads: ["day"] };
  const also = sideNotes(`${d.title} ${cls.title}`, [out.stdout]);
  const text = `Done: ${d.title} ${span(at, at + d.minutes)}, right before ${cls.title} at ${ampm(toMin(cls.start))} (${d.quick ? `I took quick as ${d.minutes} minutes` : `I made it ${d.minutes} minutes since you didn't say how long`}).${took}${also.length ? ` Also: ${also.join("; ")}.` : ""} ${UNDO}`;
  return { flow: { outcome: "done", calls, outputs: [out.stdout], reply: text }, writes: wrote(out) ? 1 : 0, reads: ["day"] };
}

/** What is under way or next today, from the calendar; with a claim ORION made earlier, corrected when the calendar disagrees. */
async function whatsNow(claim: Claim | undefined, ack: boolean, deps: DefaultDeps): Promise<DefaultOutcome> {
  const day = await deps.readDay([]).catch(() => undefined);
  if (!day) return { flow: say(NO_DAY), writes: 0, reads: [] };
  const nowMin = minuteNow(day, deps.now);
  const blocks = day.blocks.filter((b) => kindOf(b) !== "commute");
  const current = blocks.find((b) => toMin(b.start) <= nowMin && nowMin < toMin(b.end));
  const next = blocks.find((b) => toMin(b.start) > nowMin && b !== current);
  const first = current ?? next;
  const reads = ["day"];
  const claimRight = claim && first && (norm(first.title).includes(norm(claim.title)) || norm(claim.title).includes(norm(first.title)));
  if (ack && claimRight) {
    const inMin = toMin(first!.start) - nowMin;
    return { flow: say(`Got it. ${first!.title} at ${ampm(toMin(first!.start))} is next${inMin > 0 ? `, in ${inMin} minutes` : ""}.`), writes: 0, reads };
  }
  let where = "";
  if (claim && !claimRight) {
    const tomorrow = await deps.readDay(["--date", "tomorrow"]).catch(() => undefined);
    reads.push("day-tomorrow");
    const there = tomorrow?.blocks.find((b) => norm(b.title).includes(norm(claim.title)));
    where = there ? ` ${there.title} is tomorrow, ${ampm(toMin(there.start))}.` : ` ${claim.title} isn't next.`;
  }
  const lead = claim && !claimRight ? "Correction to what I said: " : "";
  let text: string;
  if (current) text = `${lead}${current.title}, now (${spoken(current)}).${next ? ` After that, ${next.title} at ${ampm(toMin(next.start))}.` : ""}`;
  else if (next) {
    const gap = toMin(next.start) - nowMin;
    const soon = gap >= 30 && deps.deadlines ? soonDeadlines(await deps.deadlines().catch(() => null), deps.now, 1) : [];
    if (soon.length) reads.push("deadlines");
    text = `${lead}Next is ${next.title} at ${ampm(toMin(next.start))}, in ${gap >= 60 ? `${Math.floor(gap / 60)} h ${gap % 60 ? `${gap % 60} min` : ""}`.trim() : `${gap} minutes`}.${soon[0] ? ` Until then, the ${soon[0].title} is ${soon[0].when}, so that's the best use of the time.` : ""}`;
  } else {
    const tomorrow = await deps.readDay(["--date", "tomorrow"]).catch(() => undefined);
    if (!reads.includes("day-tomorrow")) reads.push("day-tomorrow");
    const t = tomorrow?.blocks[0];
    text = `${lead}Nothing else is on today${t ? `; next is ${t.title} at ${ampm(toMin(t.start))} tomorrow` : ""}.`;
  }
  return { flow: say(`${text}${where}`.trim()), writes: 0, reads };
}

/** Carries out the default (or reads the day for "what now") and builds the reply from what the scheduler printed. */
export async function runDayDefault(d: DayDefault, deps: DefaultDeps): Promise<DefaultOutcome> {
  if (d.kind === "lighten") return lighten(d, deps);
  if (d.kind === "with-person") return withPerson(d, deps);
  if (d.kind === "before-class") return beforeClass(d, deps);
  return whatsNow(d.claim, d.kind === "ack-claim", deps);
}
