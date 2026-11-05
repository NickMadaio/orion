/*
 Why a scheduler run refused, as data (w20 sched). The words belong to the wording layer (schedule-reply.ts); this is the cause it
 should say, read from what orion-reschedule printed, so "didn't fit" is never the whole answer:
   { reason: "after_bedtime", bedtime: "21:50" }   the clock he asked for is after the day's end
   { reason: "no_room" }                            the day is full around it (a class or plan in the way, nothing low-priority to give)
   { reason: "passed", at: "19:00" }                a start already behind us (day-edit logs these instead of refusing)
   { reason: "no_such_block", name }                nothing by that name on that day
   { reason: "too_short" | "too_far_ahead" | "class_in_the_way" | "other", detail }
 day-edit-run.ts attaches the list to the FlowResult it returns as `failures`.
*/
import { toMin } from "./intent-time.js";

export type ScheduleFailure =
  | { reason: "after_bedtime"; bedtime: string; what?: string }
  | { reason: "no_room"; what?: string }
  | { reason: "passed"; at?: string; what?: string }
  | { reason: "no_such_block"; name: string }
  | { reason: "too_short" | "too_far_ahead" | "class_in_the_way" | "other"; detail?: string; what?: string };

const hhmm = /(\d{2}:\d{2})/;
/** `ctx.bedtime` (HH:MM) and `ctx.start` (minutes) let a "did not fit" be told apart as "after bedtime". */
export function failureReason(stdout: string, ctx: { bedtime?: string; start?: number; what?: string } = {}): ScheduleFailure | undefined {
  const what = ctx.what;
  const base = what ? { what } : {};
  if (/already started|already ended|already past|has already passed|is already over/i.test(stdout)) return { reason: "passed", ...(hhmm.exec(stdout)?.[1] ? { at: hhmm.exec(stdout)![1]! } : {}), ...base };
  const none = /no block called "([^"]+)"|no movable block by that name|not found on/i.exec(stdout);
  if (none) return { reason: "no_such_block", name: none[1] ?? what ?? "" };
  if (/shorter than 5 minutes/.test(stdout)) return { reason: "too_short", ...base };
  if (/more than 3 hours ahead|before 04:00/.test(stdout)) return { reason: "too_far_ahead", ...base };
  if (/did not fit|could not fit|no longer fits|NOT BOOKED/.test(stdout)) {
    if (ctx.bedtime && ctx.start !== undefined && ctx.start >= toMin(ctx.bedtime)) return { reason: "after_bedtime", bedtime: ctx.bedtime, ...base };
    return { reason: "no_room", ...base };
  }
  if (/class|plan with people/i.test(stdout) && /NOTHING WAS CHANGED|refus/i.test(stdout)) return { reason: "class_in_the_way", ...base };
  if (/NOTHING WAS CHANGED|NOTHING WAS BOOKED/.test(stdout)) return { reason: "other", detail: stdout.split("\n").find((l) => /NOTHING WAS/.test(l))?.slice(0, 160), ...base };
  return undefined;
}
