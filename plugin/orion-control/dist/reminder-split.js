import { planReminder } from "./reminder-flow.js";
import { REMINDER_START, takeClause } from "./ask-clauses.js";
/** A reminder clause and the message left. The reminder's own words run to a sentence break, "also", "then" or a question (ask-clauses.ts), never to a plain "and". */
export function splitReminderAsk(message) {
    const s = takeClause(message, (c) => REMINDER_START.test(c.trim()));
    return s ? { clause: s.clause, rest: s.rest } : undefined;
}
/** Sets the reminders the clause asks for and says so from the store; undefined when the planner would not set a plain one-off (the whole message goes on as before). */
export async function runReminderClause(clause, deps) {
    const plan = await planReminder({ message: clause, now: deps.now, extract: deps.extract, list: deps.list }).catch(() => undefined);
    if (plan?.kind !== "call" || plan.action !== "alarm_set")
        return undefined;
    let steps;
    try {
        steps = JSON.parse(plan.args).steps;
    }
    catch {
        return undefined;
    }
    if (!steps.length || steps.some((st) => st.action !== "alarm_set" || !st.at || !st.label || st.repeat || st.place))
        return undefined;
    const calls = [];
    const outputs = [];
    for (const st of steps) {
        const dueAt = Date.parse(st.at);
        if (!Number.isFinite(dueAt) || dueAt <= deps.now.getTime())
            return { text: "I couldn't set that reminder (the time had already passed), so nothing was set.", calls, outputs, ok: false };
        const made = await deps.add(dueAt, st.label, st.important === true).catch(() => undefined);
        const back = made ? (await deps.list().catch(() => [])).find((r) => r.id === made.id && r.dueAt === dueAt) : undefined;
        calls.push(`alarm_set ${st.at} ${st.label}`);
        outputs.push(JSON.stringify(back ? { id: back.id, dueAt: back.dueAt } : { error: "not in the store" }));
        if (!back)
            return { text: "I couldn't set that reminder, so nothing was set. Want me to try again?", calls, outputs, ok: false };
    }
    return { text: plan.reply, calls, outputs, ok: true };
}
