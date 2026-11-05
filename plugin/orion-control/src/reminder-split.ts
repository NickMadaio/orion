/*
 A reminder joined to another ask (w20 round 6, live gate 4 #100: "put pasta prep in at 6pm and remind me at 5 to buy pasta" booked the reminder as a calendar block).
 The reminder clause is planned by the ordinary reminder planner (reminder-flow.ts), written to the store by code and read back; only the other clause goes on to the
 normal routes, and the reply says both. A clause the planner cannot finish (no time, a repeat, "when i get home") is left whole to the old routes.
*/
import type { Reminder } from "./ambient.js";
import { planReminder, type Extracted, type StoredReminder } from "./reminder-flow.js";
import { REMINDER_START, takeClause } from "./ask-clauses.js";

/** A reminder clause and the message left. The reminder's own words run to a sentence break, "also", "then" or a question (ask-clauses.ts), never to a plain "and". */
export function splitReminderAsk(message: string): { clause: string; rest: string } | undefined {
  const s = takeClause(message, (c) => REMINDER_START.test(c.trim()));
  return s ? { clause: s.clause, rest: s.rest } : undefined;
}

export type ReminderDeps = {
  now: Date;
  extract: (message: string) => Promise<Extracted>;
  list: () => Promise<StoredReminder[]>;
  add: (dueAt: number, label: string, important: boolean) => Promise<Reminder>;
};
export type ReminderClauseOutcome = { text: string; calls: string[]; outputs: string[]; ok: boolean };

/** Sets the reminders the clause asks for and says so from the store; undefined when the planner would not set a plain one-off (the whole message goes on as before). */
export async function runReminderClause(clause: string, deps: ReminderDeps): Promise<ReminderClauseOutcome | undefined> {
  const plan = await planReminder({ message: clause, now: deps.now, extract: deps.extract, list: deps.list }).catch(() => undefined);
  if (plan?.kind !== "call" || plan.action !== "alarm_set") return undefined;
  let steps: Array<{ action?: string; at?: string; label?: string; repeat?: unknown; place?: unknown; important?: boolean }>;
  try { steps = (JSON.parse(plan.args) as { steps: typeof steps }).steps; } catch { return undefined; }
  if (!steps.length || steps.some((st) => st.action !== "alarm_set" || !st.at || !st.label || st.repeat || st.place)) return undefined;
  const calls: string[] = []; const outputs: string[] = [];
  for (const st of steps) {
    const dueAt = Date.parse(st.at!);
    if (!Number.isFinite(dueAt) || dueAt <= deps.now.getTime()) return { text: "I couldn't set that reminder (the time had already passed), so nothing was set.", calls, outputs, ok: false };
    const made = await deps.add(dueAt, st.label!, st.important === true).catch(() => undefined);
    const back = made ? (await deps.list().catch(() => [])).find((r) => r.id === made.id && r.dueAt === dueAt) : undefined;
    calls.push(`alarm_set ${st.at} ${st.label}`); outputs.push(JSON.stringify(back ? { id: back.id, dueAt: back.dueAt } : { error: "not in the store" }));
    if (!back) return { text: "I couldn't set that reminder, so nothing was set. Want me to try again?", calls, outputs, ok: false };
  }
  return { text: plan.reply, calls, outputs, ok: true };
}
