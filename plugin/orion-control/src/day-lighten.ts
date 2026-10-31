/*
 Tired, sick, slept badly, stressed: lighten the real day (2026-10-31, gate run-1031133008 cluster 4).

 "im so tired i can barely think" got "Want to log a quick rest or take a supplement?", "feel like crap, think im getting sick"
 got "log your water intake", "im so stressed about everything" got "take a slow breath and drink some water", and "slept like
 garbage, fix my day" got "Not done: nothing could be booked". None of them read his day.

 Code reads the day (orion-reschedule show --json) and his deadlines, and works from his priorities (classes fixed > gym > deadlines
 and study > side project > other > rest):
   - a nap or rest slot (after the next class when there is one; not in the evening);
   - the lowest-priority movable block comes off today (other, then side project; never a class, gym, study or anything fixed);
   - classes are never touched; gym stays at its time and length, as an easy session (renamed "<Gym> (easy)").
 Nick's rule: an explicit "do it" ("fix my day", "add a nap", "cut the side project") means act; otherwise ONE concrete change is
 proposed, with yes/no, and his "yes" on the next turn carries it out. The reply names his real next class and deadlines.
 Pure where it can be: readLighten and planLighten take strings and data; runLighten takes the script runner.
*/
import type { Day, DayBlock, FlowResult } from "./schedule-flow.js";
import type { DeadlineRead } from "./deadline-read.js";
import type { ScriptRun } from "./reality.js";

export type LightenKind = "tired" | "sick" | "slept" | "stressed";
export type LightenRead = { kind: LightenKind; doIt: boolean; rank: boolean; nap?: { minutes: number; at?: string; afterClass?: boolean }; cut: string[] };
/** One scheduler call and how it is said once it worked. */
export type LightenStep = { args: string[]; said: string };
/** What a "yes" to the proposal runs: scheduler steps, or a focus session start (said as his words for the session flow). */
export type LightenPending = { steps: LightenStep[] } | { session: string };
export type LightenPlan = { text: string; steps: LightenStep[]; pending?: LightenPending };

const LEAD = String.raw`(?:i'?m|im|i am|feel(?:ing)?|i feel|so|really|super|very|kinda|pretty|totally|completely|absolutely|literally)`;
const TIRED = new RegExp(String.raw`\b${LEAD}\s+(?:so\s+|really\s+|super\s+|very\s+|kinda\s+|pretty\s+|totally\s+|completely\s+|absolutely\s+|literally\s+)*(?:tired|exhausted|knackered|wrecked|shattered|drained|wiped(?: out)?|fried|zonked|sleepy|burnt out|burned out|running on empty)\b(?!\s+of\b)|\bcan(?:'?t|not)?\s+barely (?:think|function|keep my eyes open|stay awake|focus)\b|\brunning on (?:empty|fumes|no sleep)\b|\bno energy\b`, "i");
const SICK = new RegExp(String.raw`\b(?:i'?m|im|i am|feel(?:ing)?|think i'?m|i think i'?m)\s+(?:\w+\s+)?(?:sick|ill|unwell|poorly|feverish|nauseous|coming down with)\b(?!\s+of\b)|\bfeel(?:ing)?\s+(?:like\s+)?(?:crap|shit|garbage|trash|death|awful|terrible|horrible|rubbish)\b|\b(?:getting|got|have|caught)\s+(?:a\s+|the\s+)?(?:cold|flu|fever|bug|migraine|stomach bug|covid)\b`, "i");
const SLEPT = /\bslept (?:like (?:garbage|crap|shit|trash|rubbish|hell)|(?:so )?(?:badly|terribly|awfully|horribly|poorly|bad|awful|terrible)|(?:so )?little)\b|\b(?:only|barely|hardly) (?:slept|got)\b[^.,]*\b(?:\d|one|two|three|four|five|hours?|sleep)|\b(?:only |barely |hardly )slept\b|\b(?:didn'?t|did not|couldn'?t|could not|barely) (?:get any |get much |)sleep\b|\bno sleep\b|\b(?:bad|rough|terrible|awful|crap|shit) (?:night|sleep)\b|\bup all night\b/i;
const HOURS_OF_SLEEP = /\b(?:only |like |maybe |about |barely |got )*(?:[1-5](?:\.5)?|one|two|three|four|five)(?: and a half)? ?(?:h|hrs?|hours?) (?:of )?sleep\b/i;
const SLEPT_HOURS = /\bslept (?:only |like |maybe |about |around )*(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine)(?: and a half)? ?(?:h|hrs?|hours?)\b/i;
// First person only: "my mom is so stressed" is not his.
const STRESSED = /(?:^|\b(?:i'?m|im|i am|i feel|feel(?:ing)?|getting|i'?ve been|ive been)\s+)(?:so\s+|really\s+|super\s+|kinda\s+|pretty\s+|completely\s+)*(?:stressed|overwhelm\w*|swamped|drowning|freaking out|panicking|anxious)\b|\btoo much (?:to do|on my plate)\b|\bso much to do\b/i;
const RANK = /\b(?:rank|prioriti[sz]e|triage)\b|\bwhat (?:should i|do i) (?:do|focus on|start with|tackle) first\b|\bwhat matters most\b|\bin order of (?:importance|priority)\b/i;
const DO_IT = /\b(?:fix|sort(?: out)?|lighten|ease|redo|rework|adjust|rejig|clear|make)\s+(?:up\s+)?(?:my |the |today'?s? |tonight'?s? |this )?(?:day|schedule|plan|calendar|evening|afternoon|tonight|today)\b|\b(?:do it|go ahead|just do it|make it lighter|make (?:it|today|my day) easier|lighten (?:it|things) up)\b|\b(?:add|book|put|give me|schedule|slot)\s+(?:me\s+)?(?:in\s+)?(?:a |an )?(?:\d+\s*(?:-\s*)?(?:min(?:ute)?s?|m)?\s*)?nap\b|\b(?:cut|drop|cancel|scrap|ditch|remove|get rid of|bin)\s+(?!it\b)\w/i;
/** Another change in the same breath is the schedule flow's ("im tired, move gym to 8"), as is a reminder. */
const OTHER_CHANGE = /\b(?:move|push|pull|swap|resize|extend|shorten|reschedule|remind|alarm|timer|log|start (?:a|an|my|the)|session|text|email)\b|\?|\b(?:what'?s|whats|what is|when is|how (?:long|much|many))\b/i;
/** Taking a named block or class off ("no gym for me, i'm sick", "not going to the lecture") is the gym guard's or the schedule flow's. */
const SKIPS_A_BLOCK = /\bno (?:gym|class|lecture|lab|seminar|study)\b|\bskip(?:ping)?\b|\bnot (?:going|gonna go|coming)\b|\bcan'?t (?:go|make it|do (?:gym|class))\b|\bcall(?:ing)? in\b|\binstead of\b/i;
const CUT = /\b(?:cut|drop|cancel|scrap|ditch|skip|remove|get rid of|bin)\s+(?:the\s+|my\s+|today'?s\s+|tonight'?s\s+)?([a-z][a-z' -]{1,30}?)(?=\s+(?:tonight|today|this evening|and|then|so|cause|because|im|i'm|for)\b|\s*[.,!;]|$)/gi;
const WORD_HOURS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

const slept = (m: string): boolean => {
  if (SLEPT.test(m) || HOURS_OF_SLEEP.test(m)) return true;
  const h = SLEPT_HOURS.exec(m)?.[1];
  if (!h) return false;
  const hours = WORD_HOURS[h.toLowerCase()] ?? Number(h);
  return hours < 6;
};

function readNap(m: string): LightenRead["nap"] {
  if (!/\bnap\b/i.test(m)) return undefined;
  const len = /(\d+)\s*(?:-\s*)?(?:min(?:ute)?s?|m)\s+nap\b|\bnap\s+(?:for\s+)?(\d+)\s*(?:min|m)\b/i.exec(m);
  const at = /\bnap\b[^.,;]*?\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(m);
  const minutes = Math.min(90, Math.max(10, Number(len?.[1] ?? len?.[2] ?? 30)));
  const hour = at ? Number(at[1]) % 12 + ((at[3]?.toLowerCase() === "pm" || (!at[3] && Number(at[1]) < 9)) ? 12 : 0) : undefined;
  return { minutes, ...(at ? { at: `${String(hour).padStart(2, "0")}:${at[2] ?? "00"}` } : {}), ...(/\bnap\b[^.,;]*\bafter (?:my |the )?(?:class|lecture|lab|seminar)/i.test(m) ? { afterClass: true } : {}) };
}

/** A statement of being tired, sick, short of sleep or stressed, and what (if anything) he asked to be done about it. */
export function readLighten(message: string): LightenRead | null {
  const m = message.trim();
  const kind: LightenKind | null = slept(m) ? "slept" : SICK.test(m) ? "sick" : TIRED.test(m) ? "tired" : STRESSED.test(m) ? "stressed" : null;
  if (!kind) return null;
  const rank = RANK.test(m);
  if (!rank && (OTHER_CHANGE.test(m) || SKIPS_A_BLOCK.test(m))) return null;
  const cut = [...m.matchAll(CUT)].map((x) => x[1]!.trim()).filter((t) => !/^(?:it|that|this|everything|all)$/i.test(t));
  const nap = readNap(m);
  return { kind, doIt: DO_IT.test(m), rank, cut, ...(nap ? { nap } : {}) };
}

/** His go-ahead to what was just proposed ("yes", "yeah go", "ok start it", "book it"). */
const YES = /^(?:(?:yeah|yea|ya|yes|yep|yup|ok(?:ay)?|k|sure|alright|fine|please|pls)[,.!\s]*)+(?:(?:go|let'?s go|lets go|go for it|go ahead|do it|do that|start it|book it|please|pls|thanks|ty)[,.!\s]*)*$|^(?:go|let'?s go|lets go|go for it|go ahead|do it|do that|start it|book it|please do)[.!\s]*$/i;
export const saysYes = (message: string): boolean => YES.test(message.trim());

// ---- the day ----
const toMin = (t: string): number => { const [h, mm] = t.split(":").map(Number); return (h ?? 0) * 60 + (mm ?? 0); };
const hhmm = (n: number): string => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const ampm = (t: string): string => { const n = toMin(t); const h = Math.floor(n / 60) % 24; return `${(h + 11) % 12 + 1}:${String(n % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const kindOf = (b: DayBlock): string => b.kind ?? (/\b(lecture|seminar|lab|class|tutorial)\b|\b[a-z]{2,4}\d{3,4}\b/i.test(b.title) ? "class" : /\bgym|workout/i.test(b.title) ? "gym" : /\byoutube|side project|video|edit/i.test(b.title) ? "side_project" : /\bstudy|revis|homework|problem set/i.test(b.title) ? "study" : /\bnap|rest|break/i.test(b.title) ? "rest" : /\bbreakfast|lunch|dinner|meal/i.test(b.title) ? "meal" : "other");
const isClass = (b: DayBlock) => kindOf(b) === "class";
const isGym = (b: DayBlock) => kindOf(b) === "gym";
const KEEP = new Set(["class", "gym", "study", "deadline", "meal", "rest", "sleep", "commute", "nap"]);
/** "Other" he can safely lose today: chores and leisure. An unknown task ("AE1 Marketing Presentation", "finish resume") may be
 *  deadline work, so it is never the one taken off (found replaying his real 10-31 day). */
const LOW_OTHER = /\b(?:laundry|groceries|grocery|shopping|errands?|clean(?:ing)?|tidy(?:ing)?|chores?|games?|gaming|tv|netflix|admin|inbox|emails?|organi[sz]e|declutter)\b/i;
/** Removal order, lowest priority first: chores/leisure, then side project. Never fixed, never already started. */
function lowestBlock(day: Day, nowMin: number): DayBlock | undefined {
  const movable = day.blocks.filter((b) => !b.fixed && toMin(b.start) >= nowMin && !KEEP.has(kindOf(b)) && !/\b(?:with|meet|commute|travel|home)\b/i.test(b.title));
  return movable.find((b) => kindOf(b) === "other" && LOW_OTHER.test(b.title)) ?? movable.find((b) => kindOf(b) === "side_project");
}
const nextClass = (day: Day, nowMin: number) => day.blocks.filter(isClass).find((b) => toMin(b.end) > nowMin);
const gymAhead = (day: Day, nowMin: number) => day.blocks.find((b) => isGym(b) && toMin(b.end) > nowMin);
/** Where a nap goes: right after the class he is in or the next one (when that ends before 6 PM), else in five minutes; none in the evening. */
function napSlot(day: Day | undefined, nowMin: number, nap: NonNullable<LightenRead["nap"]>): { args: string[]; at: string; after?: string } | null {
  if (nap.at) return { args: ["--at", nap.at], at: nap.at };
  const cls = day ? nextClass(day, nowMin) : undefined;
  if (cls && (nap.afterClass || toMin(cls.end) <= 18 * 60)) return { args: ["--after", cls.title], at: cls.end, after: cls.title };
  if (nap.afterClass || nowMin >= 18 * 60) return null;
  const start = Math.ceil((nowMin + 5) / 5) * 5;
  return { args: ["--at", hhmm(start)], at: hhmm(start) };
}
const fuzzy = (day: Day, said: string): DayBlock | undefined => {
  const s = said.toLowerCase().replace(/\s+(?:block|session|time)$/, "");
  const side = /\b(?:side project|youtube|video|editing|content)\b/.test(s);
  return day.blocks.find((b) => !b.fixed && !isClass(b) && (b.title.toLowerCase().includes(s) || (side && kindOf(b) === "side_project")));
};

// ---- deadlines ----
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** The next deadlines in seven days, soonest first, as "the CS Midterm Thursday". */
export function soonDeadlines(read: DeadlineRead | null | undefined, now: Date, max = 2): Array<{ title: string; when: string }> {
  if (!read) return [];
  const rows = [...read.events.filter((e) => e.isDeadline !== false).map((e) => ({ title: e.title, at: new Date(e.start) })), ...read.tasks.map((t) => ({ title: t.title, at: new Date(t.due) }))]
    .filter((r) => !Number.isNaN(r.at.getTime()) && r.at.getTime() >= dayStart(now) && r.at.getTime() - now.getTime() <= 7 * 86400_000)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const seen = new Set<string>();
  return rows.filter((r) => { const k = r.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, max).map((r) => {
    const days = Math.round((dayStart(r.at) - dayStart(now)) / 86400_000);
    return { title: r.title.replace(/^due:?\s*/i, ""), when: days === 0 ? "today" : days === 1 ? "tomorrow" : WEEKDAY[r.at.getDay()]! };
  });
}
const listed = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");

/** One sentence of his real day: the next class and the nearest deadlines. Empty when nothing is known. */
function realDay(day: Day | undefined, deadlines: Array<{ title: string; when: string }>, nowMin: number): string {
  // The next class, or with none left today the next study block (what the day actually asks of him).
  const cls = day ? nextClass(day, nowMin) ?? day.blocks.find((b) => kindOf(b) === "study" && toMin(b.start) >= nowMin) : undefined;
  const parts = [...(cls ? [`${cls.title} at ${ampm(cls.start)}${toMin(cls.start) <= nowMin ? " (now)" : ""}`] : []), ...deadlines.filter((d) => !cls || !cls.title.toLowerCase().includes(d.title.toLowerCase())).map((d) => `${d.title} ${d.when}`)];
  return parts.length ? `You've still got ${listed(parts)}.` : "";
}

/** "rank what i need to do this week": his priority order with his real deadlines in it. */
function rankReply(day: Day | undefined, deadlines: Array<{ title: string; when: string }>): string {
  const classes = day?.blocks.filter(isClass).map((b) => b.title) ?? [];
  const lines = [
    `1. Classes${classes.length ? ` (${listed([...new Set(classes)])})` : ""}: fixed, you go.`,
    "2. Gym, 90 minutes every day.",
    ...deadlines.map((d, i) => `${i + 3}. ${d.title}, due ${d.when}.`),
    `${deadlines.length + 3}. An hour on the side project.`,
    `${deadlines.length + 4}. Everything else, then rest.`,
  ];
  return `In order:\n${lines.join("\n")}\n${deadlines[0] ? `Start with ${deadlines[0].title}: want 25 minutes on it now?` : "Want me to start 25 minutes on the first thing now?"}`;
}

/** What to do (steps) or propose (pending), and what to say. Pure. */
export function planLighten(read: LightenRead, ctx: { day?: Day; deadlines?: DeadlineRead | null; now: Date }): LightenPlan {
  const nowMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();
  const soon = soonDeadlines(ctx.deadlines, ctx.now);
  const context = realDay(ctx.day, soon, nowMin);
  const first = soon[0]?.title ?? (ctx.day ? ctx.day.blocks.find((b) => kindOf(b) === "study" && toMin(b.end) > nowMin)?.title : undefined);
  if (read.rank) return { text: rankReply(ctx.day, soon), steps: [], ...(first ? { pending: { session: `start a 25 min focus session on ${first}` } } : {}) };
  if (read.kind === "stressed") {
    const step = first ? `Smallest step: 25 minutes on ${first}, right now. Want me to start that?` : "Smallest step: pick the one thing due first and give it 25 minutes. Want me to start a focus session?";
    return { text: [`That's a lot at once.`, context, step].filter(Boolean).join(" "), steps: [], pending: { session: `start a 25 min focus session${first ? ` on ${first}` : ""}` } };
  }
  const day = ctx.day;
  const steps: LightenStep[] = [];
  const nap = read.nap ?? (read.doIt && !read.cut.length ? { minutes: 30 } : undefined);
  const slot = nap ? napSlot(day, nowMin, nap) : null;
  const napStep = (n: { minutes: number }, s: NonNullable<typeof slot>): LightenStep => ({ args: ["add", "Nap", String(n.minutes), ...s.args], said: `${n.minutes}-minute nap at ${ampm(s.at)}${s.after ? ` after ${s.after}` : ""}` });
  const low = day ? lowestBlock(day, nowMin) : undefined;
  const gym = day ? gymAhead(day, nowMin) : undefined;
  const easyGym: LightenStep | undefined = gym && !/\(easy\)/i.test(gym.title) ? { args: ["rename", gym.title, `${gym.title} (easy)`], said: `${gym.title} stays at ${ampm(gym.start)}, as an easy session` } : undefined;
  if (read.doIt) {
    if (nap && slot) steps.push(napStep(nap, slot));
    const named = day ? read.cut.map((c) => fuzzy(day, c)).filter((b): b is DayBlock => !!b) : [];
    const cuts = read.cut.length ? named : low ? [low] : [];
    for (const b of [...new Set(cuts)]) steps.push({ args: ["drop", b.title], said: `${b.title} off today` });
    // The default lightening (no specifics) makes gym an easy session; a named gym cut was his explicit choice.
    if (!read.cut.length && !read.nap && easyGym) steps.push(easyGym);
    if (!steps.length) return { text: [context, nowMin >= 18 * 60 ? "Too late in the day for a nap, and there's nothing light enough to take off tonight. Want an early night instead?" : "There's nothing I can take off today without touching a class, gym or study."].filter(Boolean).join(" "), steps: [] };
    return { text: "", steps };
  }
  // No explicit go-ahead: ONE concrete change, yes or no.
  const lead = read.kind === "sick" ? "That sucks." : read.kind === "slept" ? "Rough night." : "Rough.";
  const offerSlot = slot ?? napSlot(day, nowMin, { minutes: 30 });
  const napNow = offerSlot && nowMin < 18 * 60 ? napStep({ minutes: 30 }, offerSlot) : undefined;
  const proposal: LightenStep | undefined = read.kind === "sick" && low ? { args: ["rename", low.title, "Rest"], said: `rest instead of ${low.title}` }
    : napNow ?? (low ? { args: ["drop", low.title], said: `${low.title} off tonight` } : easyGym);
  if (!proposal) return { text: [lead, context, "Want me to keep today as it is and check in with you after class?"].filter(Boolean).join(" "), steps: [] };
  const ask = proposal.args[0] === "add" ? `Want a ${proposal.said}?` : proposal.args[0] === "drop" ? `Want me to take ${proposal.said.replace(/ off tonight$/, "")} off tonight?` : proposal.args[0] === "rename" && proposal.args[2] === "Rest" ? `Want ${proposal.said}?` : `Want gym as an easy session tonight?`;
  return { text: [lead, context, `${ask} Yes or no.`].filter(Boolean).join(" "), steps: [], pending: { steps: [proposal] } };
}

/** Runs the steps in order and says only what worked. A failed step stops the rest. */
export async function runLighten(steps: LightenStep[], run: ScriptRun, context = ""): Promise<{ flow: FlowResult; writes: number }> {
  const calls: string[] = []; const outputs: string[] = []; const said: string[] = [];
  let failed: LightenStep | undefined;
  for (const step of steps) {
    const out = await run("orion-reschedule", step.args).catch(() => ({ stdout: "", code: 1 }));
    calls.push(`exec orion-reschedule ${step.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`); outputs.push(out.stdout);
    if (out.code !== 0 || /NOTHING WAS|NOT BOOKED|did not fit|no such block|not found/i.test(out.stdout)) { failed = step; break; }
    said.push(step.said);
  }
  const keep = said.length ? " Classes untouched. Say \"undo\" to put it back." : "";
  const miss = failed ? ` I couldn't do the ${failed.said.replace(/ off (?:today|tonight)$/, " change")}${said.length ? "" : ", so nothing changed"}.` : "";
  const text = `${said.length ? `Done: ${listed(said)}.` : ""}${miss}${keep}${context && said.length ? ` ${context}` : ""}`.trim();
  return { flow: said.length ? { outcome: "done", calls, outputs, reply: text } : { outcome: "say", kind: "plain", text: text || "I couldn't change your day just now, so nothing changed.", calls, outputs }, writes: said.length };
}
