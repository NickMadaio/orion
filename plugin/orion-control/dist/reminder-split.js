import { planReminder } from "./reminder-flow.js";
import { splitAsk } from "./timer-flow.js";
const CLAUSE = /^(?:(?:and|also|then|please|pls)\s+)*(?:remind me|ping me|nudge me|set (?:me )?a reminder|buzz me|give me a (?:ping|nudge|reminder))\b/i;
const REST = /^(?:move|add|put|schedule|book|push|cancel|delete|remove|text|send|play|turn|log|call|make|take|drop|skip|plan|shift|open|set|start|\d)\b|^(?:a|an)\s+\d/i;
/** "put pasta prep in at 6pm and remind me at 5 to buy pasta" (either order): the reminder clause and the rest. */
export function splitReminderAsk(message) {
    const s = splitAsk(message, (part) => CLAUSE.test(part.trim()), (part) => REST.test(part.trim()) && !CLAUSE.test(part.trim()));
    return s ? { clause: s.hit, rest: s.rest } : undefined;
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
