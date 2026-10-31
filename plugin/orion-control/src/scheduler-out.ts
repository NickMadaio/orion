/*
 What one orion-reschedule (or orion-tasks) run did, read from what it printed (REV2 finding 1, 2026-10-31).

 orion-reschedule exits 0 and prints 'Written to his calendar' even when a line under it says "NOT BOOKED: X … did not fit" or
 "SHRUNK to fit": the other changes were written, and each run is one undo entry. Reading "NOT BOOKED" as a total failure told
 him "nothing changed" over a calendar that had changed, and the undo count no longer matched what the scheduler wrote.
   refused       exit non-zero, or a NOTHING WAS CHANGED/BOOKED/DROPPED header: nothing was written.
   wrote         not refused and not a run that only reports ("Nothing needed to move", "Nothing to add", a dry run).
   notBooked     the named block itself is on a NOT BOOKED line (the run may still have moved other things).
   sideNotes     every collateral change the run printed (moved, shortened, came off, did not fit), in plain words.
   writesIn      how many undo entries an orion-tasks run made (it runs orion-reschedule once per day it books).
*/
import { ampm, toMin } from "./intent-time.js";

export type ScriptOut = { stdout: string; code: number };

export const refused = (o: ScriptOut): boolean => o.code !== 0 || /NOTHING WAS (?:CHANGED|BOOKED|DROPPED)/.test(o.stdout);
const NO_WRITE = /^\s*(?:Nothing needed to move|Nothing to add|NOTHING TO PLAN|Nothing new to mark|Today already meets|Would (?:change|move|skip|cancel|add))/m;
export const wrote = (o: ScriptOut): boolean => !refused(o) && (/Written to his calendar/.test(o.stdout) || !NO_WRITE.test(o.stdout));
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const notBooked = (stdout: string, title: string): boolean => new RegExp(String.raw`NOT BOOKED: ${esc(title)}\b`, "i").test(stdout);
/** Undo entries an orion-tasks run made: one per day orion-reschedule wrote. */
export const writesIn = (stdout: string): number => (stdout.match(/Written to his calendar/g) ?? []).length
  + stdout.split("\n").filter((l) => /^\d{4}-\d{2}-\d{2}: removed\b(?!.*\()/.test(l.trim())).length;

const clock = (t: string) => ampm(toMin(t));
/** One printed line as a plain clause with the block title it is about, or null when the line is not a collateral change. */
export function noteOf(l: string): [string, string] | null {
  let m = /^moved (.+?): (\d{2}:\d{2}) → (\d{2}:\d{2})/.exec(l);
  if (m) return [m[1]!, `${m[1]} ${clock(m[2]!)} → ${clock(m[3]!)}`];
  m = /^(.+?) now ends at (\d{2}:\d{2})$/.exec(l);
  if (m) return [m[1]!, `${m[1]} now ends at ${clock(m[2]!)}`];
  m = /^bumped (.+?) \(/.exec(l);
  if (m) return [m[1]!, `${m[1]} is off today (no room)`];
  m = /^SHRUNK to fit: (.+?) (\d+) → (\d+) min/.exec(l);
  if (m) return [m[1]!, `${m[1]} shortened to ${m[3]} minutes (was ${m[2]})`];
  m = /^(?:MUST-HAVE )?NOT BOOKED: (.+?) \(\d+ min\) did not fit/.exec(l);
  if (m) return [m[1]!, `${m[1]} didn't fit, so it isn't booked`];
  m = /^NOT BOOKED: (.+?)(?: \(\d+ min\) no longer fits| — ask whether)/.exec(l);
  if (m) return [m[1]!, `${m[1]} came off (no room)`];
  m = /^SKIPPED OPTIONAL: (.+?) \(\d+ min\)/.exec(l);
  if (m) return [m[1]!, `${m[1]} didn't fit, so it isn't booked`];
  m = /^SHIFTED: (.+?) could not go at (\d{2}:\d{2}).*? booked (\d{2}:\d{2}) instead/.exec(l);
  if (m) return [m[1]!, `${m[1]} went in at ${clock(m[3]!)} instead of ${clock(m[2]!)}`];
  return null;
}
/** What else the scheduler moved, shortened or took off that the reply does not already name. Every one: no cap, so "Done" never
 *  hides a change to his calendar. */
export function sideNotes(reply: string, outputs: string[]): string[] {
  const said = reply.toLowerCase();
  const notes = outputs.flatMap((o) => o.split("\n").map((l) => l.trim()).flatMap((l): Array<[string, string]> => {
    const one = noteOf(l);
    if (one) return [one];
    const c = /^cleared \d+ prior schedule blocks?: (.+)$/.exec(l);
    return c ? c[1]!.split(/,\s+/).map((t): [string, string] => [t, `${t} is off`]) : [];
  })).filter(([title]) => !said.includes(title.toLowerCase())).map(([, n]) => n);
  return [...new Set(notes)];
}
