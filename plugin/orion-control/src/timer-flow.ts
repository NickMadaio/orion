/*
 A timer, set by code and read back (w20 round 4, live gate 2: "start a 10 min timer for the pasta" -> "I didn't manage to set that timer").
 The old route hinted the worker to make one orion_task_run call and the 9B never made it. Now code writes the timer into the reminder store
 (the same entry orion_task_run's timer_set writes, so the app's clock fires it) and the reply is built from reading the store again:

   "Timer set: 10 minutes for the pasta, it rings at 3:41 AM."
*/
import type { Reminder } from "./ambient.js";
import { describeDuration } from "./ambient.js";
import { ampm12 } from "./reminder-flow.js";
import { normalizeSpoken } from "./spoken-numbers.js";
import { timerLength, timerSeconds } from "./tool-moves.js";

export type TimerDeps = {
  add: (seconds: number, label: string) => Promise<Reminder>;
  list: () => Promise<Array<{ id: string; kind?: string; dueAt: number }>>;
  now: Date;
  /** "make it 10 min instead": the timer this one replaces, taken out first. */
  replace?: { id: string; remove: (id: string) => Promise<void> };
};
export type TimerOutcome = { id?: string; text: string; calls: string[]; outputs: string[]; ok: boolean; label: string };
export type TimerAsk = { seconds: number; label: string; replace?: boolean };

const LABEL = /\btimer\b\s*(?:for|to|called|named|:)?\s+(?:the |my |a |an |some )?([a-z][a-z' ]{1,30}?)\s*[.!]*$|\b(?:for|to)\s+(?:the |my |a |an |some )?([a-z][a-z' ]{1,30}?)\s*[.!]*$/i;
const NOT_LABEL = /^(?:instead|rather|actually|for|of|me|now|please|pls|then|min|mins|minutes?|hours?|seconds?|a while|real quick)$/i;

/** "set a 10 min timer for the pasta": 600 s, "pasta". Undefined when it is not an order for a new timer. "instead" swaps the one just set (hasLast), else is nothing. */
export function readTimer(message: string, { hasLast = false }: { hasLast?: boolean } = {}): TimerAsk | undefined {
  const instead = /\b(?:instead|rather)\b/i.test(message);
  if (instead && !hasLast) return undefined;
  const seconds = instead ? timerLength(message) : timerSeconds(message);
  if (seconds === undefined) return undefined;
  const after = normalizeSpoken(message).replace(/\b\d+\s*(?:-|\s)?\s*(?:min(?:ute)?s?|m|hours?|hrs?|h|sec(?:ond)?s?|s)\b/gi, " ").replace(/\btimer on\b/gi, "timer").replace(/\b(?:instead|rather|actually)\b/gi, " ").replace(/\s+/g, " ").trim();
  const m = LABEL.exec(after);
  const raw = (m?.[1] ?? m?.[2] ?? "").trim().replace(/\s+(?:please|pls|thanks|ok|okay)$/i, "");
  return { seconds, label: raw && !NOT_LABEL.test(raw) ? raw : "Timer", ...(instead ? { replace: true } : {}) };
}

const REST = /^(?:move|add|put|schedule|book|remind|open|set|start|push|cancel|delete|remove|text|send|play|turn|log|call|make|take|drop|skip|plan|shift|(?:a|an)\s+\d|\d)\b.*/i;
const JOIN = /^(.*?)(?:\s*,\s*(?:and\s+|then\s+)?|\s+(?:and then|and also|and|then|also|plus|after that)\s+)(.+)$/i;
/** A timer clause followed by another ask ("set a 10 min timer and move my gym to 6"): the two clauses, or undefined for a single ask. */
export function splitTimerAsk(message: string): { timer: string; rest: string } | undefined {
  const text = message.trim();
  if (timerSeconds(text) === undefined) return undefined;
  const norm = normalizeSpoken(text);
  const end = (/timer\b/i.exec(norm)?.index ?? -1) + 5;
  if (end < 5) return undefined;
  const j = JOIN.exec(text.slice(text.search(/timer\b/i) + 5));
  if (!j || !REST.test(j[2]!.trim())) return undefined;
  const cut = text.length - (text.slice(text.search(/timer\b/i) + 5).length - (j[1]!.length));
  return { timer: text.slice(0, cut).trim(), rest: j[2]!.trim() };
}

export async function runTimer(ask: TimerAsk, deps: TimerDeps): Promise<TimerOutcome> {
  const calls = [`timer_set ${ask.seconds}s ${ask.label}`];
  const fail = (why: string): TimerOutcome => ({ text: `I couldn't set that timer (${why}), so nothing is running. Want me to try again?`, calls, outputs: [why], ok: false, label: ask.label });
  let made: Reminder;
  if (deps.replace) await deps.replace.remove(deps.replace.id).catch(() => undefined);
  try { made = await deps.add(ask.seconds, ask.label); } catch (error) { return fail(error instanceof Error ? error.message.slice(0, 80) : "the reminder store refused it"); }
  const back = (await deps.list().catch(() => [])).find((r) => r.id === made.id);
  if (!back) return fail("it wasn't in the store when I checked");
  const at = new Date(back.dueAt);
  const when = ampm12(`${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`);
  const what = ask.label === "Timer" ? "" : ` for ${/^(?:the|my) /i.test(ask.label) ? "" : "the "}${ask.label}`;
  return { id: back.id, text: `${deps.replace ? "Swapped the old timer. " : ""}Timer set: ${describeDuration(ask.seconds)}${what}, it rings at ${when}.`, calls, outputs: [JSON.stringify({ id: back.id, dueAt: back.dueAt })], ok: true, label: ask.label };
}
