/*
 Front-desk tool moves, carried out (live sweep 2026-10-15, group front-desk-tools).

 The front desk's "tool" move was only a hint: instructionsFor read decision.tool for brain and the
 calendar alone, and nothing checked that a tool move led to a tool call. So "whats the weather like rn"
 got "I don't know the current weather" with no call (q001), "is it gonna rain later this week" got
 "I checked the weather… not expected to rain" with no call (q007), "set a timer for 25 min" called a
 made-up tool id "timer_set" (q032), "took my creatine" ran "orion-log water 1" (q072), and "log a
 workout, did 45 min upper body" was logged as 300 kcal of food (q073).

 For the few low-risk moves whose arguments are complete, code works out the ONE exact orion_task_run
 call (the worker makes it, through the normal gate) and finalize checks it was made — the reminder
 pattern. What no tool can do (sleep, a workout by duration) gets a fixed honest line instead.
 Escalations and every other tool keep the worker's own judgement.
*/
import type { Decision } from "./front-desk.js";

export type ToolDirective =
  /** One orion_task_run call the worker must make; `note` is extra guidance for the reply. */
  | { kind: "call"; action: string; args: string; note: string; failLine: string }
  /** Nothing can do it: this text is the whole reply. */
  | { kind: "say"; text: string };

const LOCATION = "London";
const TIMER = /\b(?:set|start|put on|run)\s+(?:a|an|the|me a)?\s*(\d+)\s*(?:-|\s)?\s*(min(?:ute)?s?|m|hours?|hrs?|h|sec(?:ond)?s?|s)\b\s*timer\b|\btimer\s+(?:for|of)\s+(\d+)\s*(min(?:ute)?s?|m|hours?|hrs?|h|sec(?:ond)?s?|s)\b/i;
const WEEK = /\b(week|weekend|next few days|coming days|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i;
const TOMORROW_WORDS = /\b(tomorrow|tmrw|tmr|tmrrw)\b/i;
// "did i take…", "have i had…", "what supplements did i take": a read of today's log, never a new dose.
const SUPPLEMENT_QUESTION = /\b(did|have|has)\s+i\b|\bwhat supplements\b|\?\s*$/i;
const SLEEP_LOG = /\b(log|logged|track|record|note)\b.*\bsleep|\bslept\b/i;
const WORKOUT_BY_TIME = /\b(workout|work out|worked out|gym session|training session|lift(?:ed|ing)?|run|ran)\b.*\b\d+\s*(min(?:ute)?s?|hours?|hrs?|h)\b/i;
const WORKOUT_SETS = /\b\d+\s*(x|reps?|sets?|lbs?|kg)\b/i;

const SLEEP_LINE = "I can't log sleep yet — ORION only tracks water, food, supplements and workout sets. Nothing was logged.";
const WORKOUT_LINE = "I can't log a workout by time yet — only exercises with their sets, like \"bench 135 for 8, 8, 6\". Nothing was logged.";

function seconds(amount: string, unit: string): number {
  const n = Number(amount);
  if (/^h/i.test(unit)) return n * 3600;
  if (/^s/i.test(unit)) return n;
  return n * 60;
}

const call = (action: string, step: Record<string, unknown>, note: string, failLine: string): ToolDirective =>
  ({ kind: "call", action, args: JSON.stringify({ steps: [{ action, ...step }] }), note, failLine });

/** The exact job for a front-desk tool move, when code can know it; null leaves the turn to the worker. */
export function toolDirective(decision: Decision | undefined, message: string): ToolDirective | null {
  if (!decision || decision.move === "escalate") return null;
  const timer = TIMER.exec(message);
  if (timer) {
    const total = seconds(timer[1] ?? timer[3] ?? "0", timer[2] ?? timer[4] ?? "m");
    if (total >= 1 && total <= 86400) return call("timer_set", { seconds: total }, "Then say the timer is set, only if the result shows it.", "I didn't manage to set that timer — nothing is running. Can you say it again?");
  }
  if (decision.move !== "tool") return null;
  const args = (decision.args ?? {}) as Record<string, unknown>;
  const tool = decision.tool ?? "";
  if (["log_intake", "supplements"].includes(tool) && SLEEP_LOG.test(message)) return { kind: "say", text: SLEEP_LINE };
  if (["log_intake", "supplements"].includes(tool) && WORKOUT_BY_TIME.test(message) && !WORKOUT_SETS.test(message)) return { kind: "say", text: WORKOUT_LINE };
  if (tool === "weather") {
    const days = WEEK.test(message) ? 7 : TOMORROW_WORDS.test(message) ? 1 : undefined;
    return call("weather_now", { location: LOCATION, ...(days ? { days } : {}) }, "Then answer his question from the result only (temperature, rain, what to wear).", "I couldn't check the weather just now — try me again in a moment.");
  }
  if (tool === "supplements") {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (args.do === "take" && name && !SUPPLEMENT_QUESTION.test(message)) return call("supplement_take", { name }, "Then say it is logged, only if the result shows it.", `I didn't manage to log your ${name} — nothing was recorded. Can you say it again?`);
    if (["search", "read", "status"].includes(String(args.do ?? "")) || SUPPLEMENT_QUESTION.test(message)) {
      return call("supplement_status", {}, "This is a question: do not log a dose. Answer from the result only (yes with the time, or no).", "I couldn't read your supplement log just now.");
    }
  }
  return null;
}
