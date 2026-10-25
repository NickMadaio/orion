/*
 What Nick hears after a scheduler run, built only from the scheduler's own lines (moved out of schedule-flow.ts, 2026-10-20).
 A run headed "NOTHING WAS CHANGED/BOOKED" wrote nothing: the plan it lists is never said as done.
*/
import type { Day, DayBlock } from "./schedule-flow.js";

/** What the exec wrapper hands back when the scheduler died without a word. */
export const UNKNOWN_OUTCOME = "OUTCOME UNKNOWN: the scheduler stopped before it reported back.";
const ampm = (t: string): string => { const [h, m] = t.split(":").map(Number); const hh = ((h ?? 0) + 11) % 12 + 1; return `${hh}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`; };

export const FAILED = /NOT BOOKED|NOTHING WAS|did not fit|usage:|not a real block|is in the past|no block called|Error/i;

/** One scheduler failure line → one short spoken clause. The raw line was spoken word for word (sweep
 *  2026-10-16): usage text, "Blocks today: … 09:00–10:30", "Do not tell him anything was added". */
export function spokenFailure(line: string): string {
  const l = line.trim().replace(/^orion-reschedule:\s*/, "")
    .replace(/^(?:MUST-HAVE )?(?:NOTHING WAS|NOT) (?:CHANGED|BOOKED|DROPPED)\b(?: on \w+day)?(?: \(\d{4}-\d{2}-\d{2}\))?[:.]?\s*/i, "")
    // Notes to the operator, and lists of his whole day, are not for Nick.
    .replace(/(?:[.;]\s+|\s+—\s+|^)(?:Tell him|Do not|Don't|If he|ask whether|Run |Use |To set|See the header|Options:|Blocks today|Fixed today|Movable blocks|Classes today|Never |swap only|skip is only)[\s\S]*$/i, "")
    .replace(/ \((?:\w+day )?\d{4}-\d{2}-\d{2}\)/g, "").trim();
  if (/^usage:|^Error\b|has no .* option|one command per call|does not take/i.test(l)) return "I couldn't make that change";
  if (!l) return "nothing could be booked";
  const rules: Array<[RegExp, (...m: string[]) => string]> = [
    [/^(.+?) (is|are) already over today/i, (_, what, verb) => `${what} ${verb === "is" ? "has" : "have"} already ended today`],
    [/^no block called "?(.+?)"? on /i, (_, what) => `there's no block called ${what}`],
    [/^no class or fixed plan called "?(.+?)"? left/i, (_, what) => `there's no class called ${what} left today`],
    [/^no "(.+?)" on .* to put it after/i, (_, what) => `there's no ${what} to put it after`],
    [/^"?(.+?)"? is one of his own calendar events/i, (_, what) => `${what} is a class or a plan with people, so it doesn't move`],
    [/^(.+?) \(\d+ min\) (?:no longer fits|did not fit)/i, (_, what) => `${what} didn't fit`],
    [/^must-haves could not fit: (.+?)\.?$/i, (_, what) => `${what} didn't fit`],
    [/^no movable block matches/i, () => "there's no movable block by that name"],
    [/^(.+?) is on \d{4}-\d{2}-\d{2}/i, (_, what) => `${what} is on another day`],
    [/is in the past/i, () => "that day is already over"],
  ];
  const hit = rules.map(([re, say]) => { const m = l.match(re); return m ? say(...m) : null; }).find((t) => t !== null);
  const said = hit ?? l;
  return said.replace(/\b(\d{2}:\d{2})\b/g, (t) => ampm(t)).replace(/\.$/, "");
}

/** What to tell Nick, from the scheduler's own output only. */
export function summarize(outputs: string[], said: string[]): { reply: string; changed: boolean } {
  const lines = outputs.flatMap((o) => o.split("\n").map((l) => l.trim()));
  const changes = lines.filter((l) => /moved|planned|added|cleared|is now|skipped|resized|extended|swapped|separated|booked|logged/i.test(l) && !FAILED.test(l) && !/^Changed|^Would change|^Written/.test(l));
  const failed = lines.filter((l) => FAILED.test(l));
  const parts: string[] = [];
  if (changes.length) parts.push(changes.slice(0, 4).join("; "));
  if (failed.length) parts.push(`Not done: ${spokenFailure(failed[0]!)}`);
  parts.push(...said.filter(Boolean));
  return { reply: parts.join(". ").replace(/^(Not done: .*[^.])$/, "$1.") || "Nothing changed.", changed: changes.length > 0 };
}

/** A scheduler run that says it wrote nothing (its first line is "NOTHING WAS CHANGED/BOOKED"). */
export const nothingWritten = (out: string): boolean => /^\s*(?:MUST-HAVE )?NOTHING WAS (?:CHANGED|BOOKED)\b/.test(out);

/** The spoken reply, built only from the scheduler's lines ("planned X: 17:15–18:00", "X moved: a → b–c"). */
export function spokenReply(outputs: string[], when?: string): string {
  // The plan a refused run lists is not what happened: only its failure lines are read.
  const lines = outputs.flatMap((o) => o.split("\n").map((l) => l.trim()).filter((l) => !nothingWritten(o) || FAILED.test(l)));
  const said: string[] = []; const cut: string[] = []; const followed: string[] = []; let logged = "";
  for (const l of lines) {
    // The block he was in, cut short for a time he stated; the blocks that slid after a change.
    let c = l.match(/^(.+?) now ends at (\d{2}:\d{2})$/);
    if (c) { cut.push(`${c[1]} ends at ${ampm(c[2]!)}`); continue; }
    c = l.match(/^moved (.+?): \d{2}:\d{2} → (\d{2}:\d{2})$/);
    if (c) { followed.push(`${c[1]} now ${ampm(c[2]!)}`); continue; }
    let m = l.match(/^planned (.+?): (\d{2}:\d{2})–(\d{2}:\d{2})/);
    if (m) { said.push(`${m[1]} ${ampm(m[2]!)}–${ampm(m[3]!)}`); continue; }
    m = l.match(/^(.+?) moved: \d{2}:\d{2} → (\d{2}:\d{2})–(\d{2}:\d{2})/);
    if (m) { said.push(`${m[1]} now ${ampm(m[2]!)}–${ampm(m[3]!)}`); continue; }
    m = l.match(/^(.+?) is now (\d+) min: (\d{2}:\d{2})–(\d{2}:\d{2})/);
    if (m) { said.push(`${m[1]} is now ${m[2]} minutes, ${ampm(m[3]!)}–${ampm(m[4]!)}`); continue; }
    m = l.match(/^cleared \d+ prior schedule blocks?: (.+)$/i) ?? l.match(/^removed (.+)$/i);
    if (m) { said.push(`cleared ${m[1]}`); continue; }
    if (/^Logged .+/.test(l)) { logged = l; continue; }
    m = l.match(/^(?:Undone: )?skipped (.+?)(?: today|$)/i);
    if (m) { said.push(`${m[1]} is off today`); continue; }
  }
  // The header "NOTHING WAS BOOKED …" says nothing by itself; the NOT BOOKED line under it says what (review 3, 2026-10-16).
  const failures = lines.filter((l) => FAILED.test(l));
  const failed = failures.find((l) => spokenFailure(l) !== "nothing could be booked") ?? failures[0];
  // Spoken: three moved blocks can be named; more is a count ("4 other blocks moved to follow it").
  const rest = followed.length > 3 ? [`${followed.length} other blocks moved to follow it`] : followed;
  const all = said.length ? [...said, ...cut, ...rest] : [];
  // when: the day it was for ("Done: resume work 5:50 PM" for tomorrow sounded like today, q020).
  // A run that only partly fits never opens with "Done" (2026-10-25 review): what did not happen first, then what did.
  if (failed && all.length && !logged) return `Partly done${when ? ` for ${when}` : ""}. Not done: ${spokenFailure(failed)}. What did change: ${all.slice(0, 6).join("; ")}.`;
  const parts = [all.length ? `Done${when ? ` for ${when}` : ""}: ${all.slice(0, 6).join("; ")}.` : "", failed ? `Not done: ${spokenFailure(failed)}.` : ""].filter(Boolean);
  // A log carries its own one-line summary (what was logged, what moved, what is off today).
  if (logged) return [logged, failed ? `Not done: ${spokenFailure(failed)}.` : ""].filter(Boolean).join(" ");
  return parts.join(" ") || "Nothing on your day changed.";
}

const spanOf = (b: DayBlock): string => `${ampm(b.start)}–${ampm(b.end)}`;
/** What differs between two reads of the same day, in plain words: added, removed, moved. */
export function dayDiff(before: Day, after: Day): string[] {
  const key = (b: DayBlock) => `${b.title}|${b.start}|${b.end}`;
  const was = new Set(before.blocks.map(key)); const is = new Set(after.blocks.map(key));
  const gone = before.blocks.filter((b) => !is.has(key(b))); const added = after.blocks.filter((b) => !was.has(key(b)));
  const out: string[] = [];
  for (const b of added) {
    const old = gone.find((g) => g.title === b.title);
    if (old) { gone.splice(gone.indexOf(old), 1); out.push(`${b.title} moved from ${spanOf(old)} to ${spanOf(b)}`); }
    else out.push(`${b.title} added at ${spanOf(b)}`);
  }
  for (const b of gone) out.push(`${b.title} (${spanOf(b)}) is gone`);
  return out;
}

/** After a crash or an unknown outcome: what the calendar reads now against before, or that it cannot be known. Never "nothing changed". */
export function uncertainReply(before: Day | undefined, after: Day | undefined, when?: string): string {
  const lead = "The scheduler stopped before it reported back.";
  if (!before || !after) return `${lead} I couldn't compare your calendar${when ? ` for ${when}` : ""} with how it was, so it may have changed. Check it, and say "undo" to put the last change back.`;
  const diff = dayDiff(before, after);
  if (diff.length) return `${lead} Your calendar${when ? ` for ${when}` : ""} now differs from before: ${diff.slice(0, 5).join("; ")}. Say "undo" to put it back.`;
  return `${lead} Your calendar${when ? ` for ${when}` : ""} reads the same as before, but I can't be sure the change didn't go through. Say "undo" if anything looks wrong.`;
}

const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hm2min = (t: string): number => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const lengthWords = (n: number): string => (n === 60 ? "an hour" : n === 90 ? "an hour and a half" : n === 120 ? "two hours" : n % 60 === 0 ? `${n / 60} hours` : `${n} minutes`);
/**
 * Live run 3 (2026-10-21): "piano practice first after class" booked a new 60-minute block at 1:20 PM and said only "Done: piano practice 1:20-2:20 PM".
 * For each block a `day --plan` created that was not on his day: that it was added, how long and why that long, and where it landed if not where asked.
 */
export function addedNotes(before: Day, outputs: string[], argvs: string[][], message: string, opts: { statedMinutes?: number; landed?: boolean } = {}): string {
  const asked = new Map<string, { minutes: number; at?: number }>();
  for (const argv of argvs.filter((a) => a[0] === "day")) argv.forEach((a, i) => {
    if (argv[i - 1] !== "--plan") return;
    const [title, minutes, at] = a.split(",").map((x) => x.trim());
    if (title) asked.set(norm(title), { minutes: Number(minutes), ...(at && /^\d{1,2}:\d{2}$/.test(at) ? { at: hm2min(at) } : {}) });
  });
  const notes: string[] = [];
  for (const line of outputs.flatMap((o) => (nothingWritten(o) ? [] : o.split("\n")))) {
    const m = line.trim().match(/^planned (.+?): (\d{2}:\d{2})–(\d{2}:\d{2})/);
    const plan = m ? asked.get(norm(m[1]!)) : undefined;
    if (!m || !plan || before.blocks.some((b) => norm(b.title) === norm(m[1]!))) continue;
    const start = hm2min(m[2]!); const minutes = hm2min(m[3]!) - start;
    const anchor = before.plan?.anchors.find((a) => norm(a.title) === norm(m[1]!));
    const why = anchor ? ", its usual length" : opts.statedMinutes || /\b\d+\s*(?:min|hour|hr)|\b(?:an?|half an?) hour\b/i.test(message) ? "" : ". You didn't say how long, so that's a default length; tell me if it should be different";
    const cap = m[1]!.replace(/^./, (c) => c.toUpperCase());
    const moved = !opts.landed && plan.at !== undefined && plan.at !== start ? ` It couldn't go at ${ampm(`${String(Math.floor(plan.at / 60)).padStart(2, "0")}:${String(plan.at % 60).padStart(2, "0")}`)}, so that's the first free time after it.` : "";
    notes.push(`${cap} wasn't on your day, so I added ${lengthWords(minutes)} at ${ampm(m[2]!)}${why}.${moved}`);
  }
  return notes.join(" ");
}
